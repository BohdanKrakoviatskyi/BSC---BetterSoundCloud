use crate::{AudioError, DspSettings, LocalTrack, SharedSpectrum};
use rodio::{OutputStream, OutputStreamBuilder, Sink, Source};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    pub playing: bool,
    pub position_ms: u64,
    pub duration_ms: Option<u64>,
    pub volume: f32,
}

struct State {
    _stream: OutputStream,
    sink: Arc<Sink>,
    duration_ms: Option<u64>,
    volume: f32,
    position_base: Duration,
    paused: Arc<AtomicBool>,
}

/// Device-backed playback controller. Track opening happens off the UI thread.
#[derive(Clone)]
pub struct AudioPlayer {
    state: Arc<Mutex<Option<State>>>,
    spectrum: SharedSpectrum,
}

impl Default for AudioPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioPlayer {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(None)),
            spectrum: SharedSpectrum::new(),
        }
    }
    pub fn play_file(&self, path: String, settings: DspSettings) -> Result<(), AudioError> {
        let mut source = LocalTrack::open(path, settings)?;
        let duration_ms = source.total_duration().map(|d| d.as_millis() as u64);
        let paused = Arc::new(AtomicBool::new(false));
        source.set_observers(Arc::clone(&paused), self.spectrum.clone());
        let stream = OutputStreamBuilder::open_default_stream()
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        let sink = Arc::new(Sink::connect_new(stream.mixer()));
        sink.append(source);
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *state = Some(State {
            _stream: stream,
            sink,
            duration_ms,
            volume: 1.0,
            position_base: Duration::ZERO,
            paused,
        });
        Ok(())
    }
    pub fn pause(&self) {
        if let Ok(state) = self.state.lock()
            && let Some(s) = state.as_ref()
        {
            s.paused.store(true, Ordering::Release);
            s.sink.pause();
        }
    }
    pub fn resume(&self) {
        if let Ok(state) = self.state.lock()
            && let Some(s) = state.as_ref()
        {
            s.paused.store(false, Ordering::Release);
            s.sink.play();
        }
    }
    pub fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            *state = None;
        }
    }
    pub fn next_track(&self) {
        if let Ok(state) = self.state.lock()
            && let Some(s) = state.as_ref()
        {
            s.sink.skip_one();
        }
    }
    pub fn spectrum(&self) -> SharedSpectrum {
        self.spectrum.clone()
    }
    pub fn set_spectrum_enabled(&self, enabled: bool) {
        self.spectrum.set_enabled(enabled);
    }
    pub fn set_dsp_settings(&self, settings: DspSettings) -> Result<(), String> {
        let state = self.state.lock().map_err(|_| "audio state lock poisoned")?;
        let current = state.as_ref().ok_or("no active track")?;
        current.sink.set_speed(settings.tempo.clamp(0.5, 2.0));
        Ok(())
    }
    pub fn seek(&self, position_ms: u64) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "audio state lock poisoned")?;
        let current = state.as_ref().ok_or("no active track")?;
        current
            .sink
            .try_seek(Duration::from_millis(position_ms))
            .map_err(|e| e.to_string())?;
        if let Some(current) = state.as_mut() {
            current.position_base = Duration::ZERO;
        }
        Ok(())
    }
    pub fn set_equalizer(&self, settings: DspSettings) -> Result<(), String> {
        if settings
            .gains_db
            .iter()
            .any(|gain| gain.abs() > f32::EPSILON)
        {
            return Err("Equalizer updates take effect when the next local track starts".into());
        }
        Ok(())
    }
    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        let volume = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let mut state = self.state.lock().map_err(|_| "audio state lock poisoned")?;
        let current = state.as_mut().ok_or("no active track")?;
        current.sink.set_volume(volume);
        current.volume = volume;
        Ok(())
    }
    pub fn snapshot(&self) -> PlaybackSnapshot {
        let Ok(state) = self.state.lock() else {
            return PlaybackSnapshot {
                playing: false,
                position_ms: 0,
                duration_ms: None,
                volume: 1.0,
            };
        };
        if let Some(s) = state.as_ref() {
            PlaybackSnapshot {
                playing: !s.sink.is_paused() && !s.sink.empty(),
                position_ms: (s.position_base + s.sink.get_pos()).as_millis() as u64,
                duration_ms: s.duration_ms,
                volume: s.volume,
            }
        } else {
            PlaybackSnapshot {
                playing: false,
                position_ms: 0,
                duration_ms: None,
                volume: 1.0,
            }
        }
    }
    pub fn ramp_volume(&self, target: f32, duration: Duration) {
        let player = self.clone();
        thread::spawn(move || {
            let start = player.snapshot().volume;
            let frames = 30_u32;
            for i in 1..=frames {
                let t = i as f32 / frames as f32;
                let _ = player.set_volume(start + (target.clamp(0.0, 1.0) - start) * t);
                thread::sleep(duration / frames);
            }
        });
    }

    pub fn crossfade_to(
        &self,
        path: String,
        settings: DspSettings,
        duration: Duration,
    ) -> Result<(), AudioError> {
        let mut next = LocalTrack::open(path, settings)?;
        let duration_ms = next.total_duration().map(|d| d.as_millis() as u64);
        let stream = OutputStreamBuilder::open_default_stream()
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        let paused = Arc::new(AtomicBool::new(false));
        next.set_observers(Arc::clone(&paused), self.spectrum.clone());
        let sink = Arc::new(Sink::connect_new(stream.mixer()));
        sink.set_volume(0.0);
        sink.append(next);
        sink.play();
        let old_sink = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let old = state.take().map(|s| s.sink);
            *state = Some(State {
                _stream: stream,
                sink: sink.clone(),
                position_base: Duration::ZERO,
                paused,
                duration_ms,
                volume: 1.0,
            });
            old
        };
        if let Some(old) = old_sink {
            let steps = 30_u32;
            let interval = duration / steps;
            for i in 1..=steps {
                let t = i as f32 / steps as f32;
                old.set_volume(1.0 - t);
                sink.set_volume(t);
                thread::sleep(interval);
            }
            old.stop();
        } else {
            sink.set_volume(1.0);
        }
        Ok(())
    }
}
