use crate::{AudioError, DspSettings, LocalTrack, SharedSpectrum};
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, unbounded};
use rodio::{OutputStream, OutputStreamBuilder, Sink, Source};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, Mutex},
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
    dsp: crate::SharedDsp,
}

enum AudioCommand {
    Play(String, DspSettings, Sender<Result<(), String>>),
    Crossfade(String, DspSettings, Duration, Sender<Result<(), String>>),
    Pause,
    Resume,
    Stop,
    Seek(u64, Sender<Result<(), String>>),
    Volume(f32, Sender<Result<(), String>>),
    Speed(f32, Sender<Result<(), String>>),
    Equalizer([f32; crate::EQ_BAND_COUNT], Sender<Result<(), String>>),
    Ramp(f32, Duration),
    Next,
    Snapshot(Sender<PlaybackSnapshot>),
}

/// Thread-safe command handle. CoreAudio's output stream is created and retained by the worker
/// thread, keeping its platform-specific non-Send callbacks away from Tauri's shared state.
#[derive(Clone)]
pub struct AudioPlayer {
    commands: Sender<AudioCommand>,
    queue: Arc<Mutex<VecDeque<String>>>,
    preloaded: Arc<Mutex<Option<(PathBuf, LocalTrack)>>>,
    spectrum: SharedSpectrum,
}

impl Default for AudioPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioPlayer {
    pub fn new() -> Self {
        let (commands, receiver) = unbounded();
        let queue = Arc::new(Mutex::new(VecDeque::new()));
        let preloaded = Arc::new(Mutex::new(None));
        let spectrum = SharedSpectrum::new();
        let worker_queue = Arc::clone(&queue);
        let worker_preloaded = Arc::clone(&preloaded);
        let worker_spectrum = spectrum.clone();
        let _ = thread::Builder::new()
            .name("resonance-audio-output".into())
            .spawn(move || {
                audio_worker(receiver, worker_queue, worker_preloaded, worker_spectrum);
            });
        Self {
            commands,
            queue,
            preloaded,
            spectrum,
        }
    }

    pub fn play_file(&self, path: String, settings: DspSettings) -> Result<(), AudioError> {
        self.call(|reply| AudioCommand::Play(path, settings, reply))
            .map_err(|error| AudioError::Io(std::io::Error::other(error)))
            .and_then(|result| result.map_err(|error| AudioError::Io(std::io::Error::other(error))))
    }

    pub fn pause(&self) {
        let _ = self.commands.send(AudioCommand::Pause);
    }
    pub fn resume(&self) {
        let _ = self.commands.send(AudioCommand::Resume);
    }
    pub fn stop(&self) {
        let _ = self.commands.send(AudioCommand::Stop);
    }

    pub fn enqueue(&self, path: String) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.push_back(path);
        }
    }
    pub fn queue(&self) -> Vec<String> {
        self.queue
            .lock()
            .map(|queue| queue.iter().cloned().collect())
            .unwrap_or_default()
    }
    pub fn preload_next(&self) -> Result<bool, AudioError> {
        let path = self
            .queue
            .lock()
            .ok()
            .and_then(|queue| queue.front().cloned());
        let Some(path) = path else {
            return Ok(false);
        };
        let decoder = LocalTrack::open(&path, DspSettings::default())?;
        *self
            .preloaded
            .lock()
            .map_err(|_| std::io::Error::other("preload lock poisoned"))? =
            Some((PathBuf::from(path), decoder));
        Ok(true)
    }
    pub fn next_queued(
        &self,
        settings: DspSettings,
        crossfade: Duration,
    ) -> Result<bool, AudioError> {
        let path = self
            .queue
            .lock()
            .ok()
            .and_then(|mut queue| queue.pop_front());
        let Some(path) = path else {
            return Ok(false);
        };
        let result = self.crossfade_to(path.clone(), settings, crossfade);
        if result.is_err()
            && let Ok(mut queue) = self.queue.lock()
        {
            queue.push_front(path);
        }
        result?;
        Ok(true)
    }
    pub fn next_track(&self) {
        let _ = self.commands.send(AudioCommand::Next);
    }
    pub fn spectrum(&self) -> SharedSpectrum {
        self.spectrum.clone()
    }
    pub fn set_spectrum_enabled(&self, enabled: bool) {
        self.spectrum.set_enabled(enabled);
    }
    pub fn set_dsp_settings(&self, settings: DspSettings) -> Result<(), String> {
        self.call(|reply| AudioCommand::Speed(settings.tempo, reply))?
    }
    pub fn set_equalizer(&self, settings: DspSettings) -> Result<(), String> {
        self.call(|reply| AudioCommand::Equalizer(settings.gains_db, reply))?
    }
    pub fn seek(&self, position_ms: u64) -> Result<(), String> {
        self.call(|reply| AudioCommand::Seek(position_ms, reply))?
    }
    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        self.call(|reply| AudioCommand::Volume(volume, reply))?
    }
    pub fn snapshot(&self) -> PlaybackSnapshot {
        let (reply_tx, reply_rx) = unbounded();
        if self
            .commands
            .send(AudioCommand::Snapshot(reply_tx))
            .is_err()
        {
            return stopped_snapshot();
        }
        reply_rx.recv().unwrap_or_else(|_| stopped_snapshot())
    }
    pub fn ramp_volume(&self, target: f32, duration: Duration) {
        let _ = self.commands.send(AudioCommand::Ramp(target, duration));
    }
    pub fn crossfade_to(
        &self,
        path: String,
        settings: DspSettings,
        duration: Duration,
    ) -> Result<(), AudioError> {
        self.call(|reply| AudioCommand::Crossfade(path, settings, duration, reply))
            .map_err(|error| AudioError::Io(std::io::Error::other(error)))
            .and_then(|result| result.map_err(|error| AudioError::Io(std::io::Error::other(error))))
    }

    fn call<T>(&self, build: impl FnOnce(Sender<T>) -> AudioCommand) -> Result<T, String> {
        let (reply_tx, reply_rx) = unbounded();
        self.commands
            .send(build(reply_tx))
            .map_err(|error| error.to_string())?;
        reply_rx.recv().map_err(|error| error.to_string())
    }
}

fn stopped_snapshot() -> PlaybackSnapshot {
    PlaybackSnapshot {
        playing: false,
        position_ms: 0,
        duration_ms: None,
        volume: 1.0,
    }
}

fn audio_worker(
    receiver: Receiver<AudioCommand>,
    queue: Arc<Mutex<VecDeque<String>>>,
    preloaded: Arc<Mutex<Option<(PathBuf, LocalTrack)>>>,
    spectrum: SharedSpectrum,
) {
    let mut state: Option<State> = None;
    loop {
        let command = match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(command) => command,
            Err(RecvTimeoutError::Timeout) => {
                if state.as_ref().is_some_and(|current| current.sink.empty()) {
                    let next_path = queue.lock().ok().and_then(|mut paths| paths.pop_front());
                    if let Some(path) = next_path
                        && let Err(error) = crossfade_state(
                            &mut state,
                            path.clone(),
                            DspSettings::default(),
                            Duration::from_millis(500),
                            &preloaded,
                            &spectrum,
                        )
                    {
                        eprintln!("automatic playback advance failed for {path}: {error}");
                        if let Ok(mut paths) = queue.lock() {
                            paths.push_front(path);
                        }
                        thread::sleep(Duration::from_secs(1));
                    }
                }
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        };
        match command {
            AudioCommand::Play(path, settings, reply) => {
                let result =
                    build_state(path, settings, &spectrum).map(|new_state| state = Some(new_state));
                let _ = reply.send(result);
            }
            AudioCommand::Crossfade(path, settings, duration, reply) => {
                let result =
                    crossfade_state(&mut state, path, settings, duration, &preloaded, &spectrum);
                let _ = reply.send(result);
            }
            AudioCommand::Pause => {
                if let Some(current) = state.as_ref() {
                    current.sink.pause();
                }
            }
            AudioCommand::Resume => {
                if let Some(current) = state.as_ref() {
                    current.sink.play();
                }
            }
            AudioCommand::Stop => state = None,
            AudioCommand::Seek(position, reply) => {
                let result = state
                    .as_ref()
                    .ok_or_else(|| "no active track".to_string())
                    .and_then(|current| {
                        current
                            .sink
                            .try_seek(Duration::from_millis(position))
                            .map_err(|error| error.to_string())
                    });
                let _ = reply.send(result);
            }
            AudioCommand::Volume(volume, reply) => {
                let result = state
                    .as_mut()
                    .ok_or_else(|| "no active track".to_string())
                    .map(|current| {
                        let volume = if volume.is_finite() {
                            volume.clamp(0.0, 1.0)
                        } else {
                            1.0
                        };
                        current.sink.set_volume(volume);
                        current.volume = volume;
                    });
                let _ = reply.send(result);
            }
            AudioCommand::Speed(tempo, reply) => {
                let result = update_dsp(&state, |settings| settings.tempo = tempo);
                let _ = reply.send(result);
            }
            AudioCommand::Equalizer(gains, reply) => {
                let result = update_dsp(&state, |settings| settings.gains_db = gains);
                let _ = reply.send(result);
            }
            AudioCommand::Ramp(target, duration) => {
                if let Some(current) = state.as_mut() {
                    let start = current.volume;
                    let target = if target.is_finite() {
                        target.clamp(0.0, 1.0)
                    } else {
                        1.0
                    };
                    for frame in 1..=30 {
                        let ratio = frame as f32 / 30.0;
                        current.sink.set_volume(start + (target - start) * ratio);
                        thread::sleep(duration / 30);
                    }
                    current.volume = target;
                }
            }
            AudioCommand::Next => {
                if let Some(current) = state.as_ref() {
                    current.sink.skip_one();
                }
            }
            AudioCommand::Snapshot(reply) => {
                let snapshot =
                    state
                        .as_ref()
                        .map_or_else(stopped_snapshot, |current| PlaybackSnapshot {
                            playing: !current.sink.is_paused() && !current.sink.empty(),
                            position_ms: current.sink.get_pos().as_millis() as u64,
                            duration_ms: current.duration_ms,
                            volume: current.volume,
                        });
                let _ = reply.send(snapshot);
            }
        }
    }
}

fn build_state(
    path: String,
    settings: DspSettings,
    spectrum: &SharedSpectrum,
) -> Result<State, String> {
    let mut source = LocalTrack::open(path, settings).map_err(|error| error.to_string())?;
    let dsp = source.shared_dsp();
    let duration_ms = source
        .total_duration()
        .map(|duration| duration.as_millis() as u64);
    source.set_observers(spectrum.clone());
    let stream = OutputStreamBuilder::open_default_stream().map_err(|error| error.to_string())?;
    let sink = Arc::new(Sink::connect_new(stream.mixer()));
    sink.append(source);
    Ok(State {
        _stream: stream,
        sink,
        duration_ms,
        volume: 1.0,
        dsp,
    })
}

fn crossfade_state(
    state: &mut Option<State>,
    path: String,
    settings: DspSettings,
    duration: Duration,
    preloaded: &Mutex<Option<(PathBuf, LocalTrack)>>,
    spectrum: &SharedSpectrum,
) -> Result<(), String> {
    let mut source = {
        let mut cached = preloaded.lock().map_err(|_| "preload lock poisoned")?;
        if let Some((_cached_path, source)) = cached
            .take()
            .filter(|(cached_path, _)| cached_path == std::path::Path::new(&path))
        {
            source
        } else {
            LocalTrack::open(&path, settings).map_err(|error| error.to_string())?
        }
    };
    let dsp = source.shared_dsp();
    let duration_ms = source
        .total_duration()
        .map(|duration| duration.as_millis() as u64);
    source.set_observers(spectrum.clone());
    let stream = OutputStreamBuilder::open_default_stream().map_err(|error| error.to_string())?;
    let sink = Arc::new(Sink::connect_new(stream.mixer()));
    sink.set_volume(0.0);
    sink.append(source);
    sink.play();
    let next = State {
        _stream: stream,
        sink,
        duration_ms,
        volume: 1.0,
        dsp,
    };
    if let Some(old) = state.take() {
        for frame in 1..=30 {
            let ratio = frame as f32 / 30.0;
            old.sink.set_volume(old.volume * (1.0 - ratio));
            next.sink.set_volume(ratio);
            thread::sleep(duration / 30);
        }
        old.sink.stop();
    } else {
        next.sink.set_volume(1.0);
    }
    *state = Some(next);
    Ok(())
}

fn update_dsp(state: &Option<State>, update: impl FnOnce(&mut DspSettings)) -> Result<(), String> {
    let current = state
        .as_ref()
        .ok_or_else(|| "no active track".to_string())?;
    let mut dsp = current
        .dsp
        .lock()
        .map_err(|_| "audio processor lock poisoned".to_string())?;
    let mut settings = dsp.settings();
    update(&mut settings);
    dsp.update_settings(settings);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_player_handle_is_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<AudioPlayer>();
    }

    #[test]
    fn local_queue_preserves_order_and_preload_is_safe_without_a_device() {
        let player = AudioPlayer::new();
        player.enqueue("first.wav".into());
        player.enqueue("second.wav".into());
        assert_eq!(player.queue(), vec!["first.wav", "second.wav"]);
        assert!(player.preload_next().is_err());
        assert_eq!(player.queue(), vec!["first.wav", "second.wav"]);
    }

    #[test]
    fn output_worker_returns_file_errors_without_hanging_the_caller() {
        let player = AudioPlayer::new();
        let missing = std::env::temp_dir()
            .join(format!(
                "resonance-missing-worker-{}.wav",
                std::process::id()
            ))
            .display()
            .to_string();
        assert!(player.play_file(missing, DspSettings::default()).is_err());
        assert!(!player.snapshot().playing);
    }
}
