use crate::{DspError, DspProcessor, DspSettings, SharedDsp, SharedSpectrum};
use rodio::Source;
use std::{collections::VecDeque, fs::File, io::BufReader, path::Path, sync::Arc, time::Duration};

const DSP_BLOCK: usize = 4096;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("could not open audio file: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not decode audio file: {0}")]
    Decode(#[from] rodio::decoder::DecoderError),
    #[error(transparent)]
    Dsp(#[from] DspError),
    #[error("audio processor lock was poisoned")]
    DspLockPoisoned,
}

/// Decodes a local track and streams DSP-processed stereo samples on demand.
pub struct LocalTrack {
    decoder: rodio::Decoder<BufReader<File>>,
    dsp: SharedDsp,
    processed: VecDeque<f32>,
    source_channels: u16,
    source_rate: u32,
    drained: bool,
    decoded_frames: u64,
    base_decoded_frames: u64,
    spectrum: Option<SharedSpectrum>,
}

impl LocalTrack {
    pub fn open(path: impl AsRef<Path>, settings: DspSettings) -> Result<Self, AudioError> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        let decoder = rodio::Decoder::builder()
            .with_data(BufReader::new(file))
            .with_seekable(true)
            .with_byte_len(len)
            .build()?;
        let source_channels = decoder.channels().max(1);
        let source_rate = decoder.sample_rate().max(1);
        let dsp = Arc::new(std::sync::Mutex::new(DspProcessor::new(settings)));
        Ok(Self {
            decoder,
            dsp,
            processed: VecDeque::new(),
            source_channels,
            source_rate,
            drained: false,
            decoded_frames: 0,
            base_decoded_frames: 0,
            spectrum: None,
        })
    }

    fn fill(&mut self) -> Result<(), AudioError> {
        while self.processed.is_empty() && !self.drained {
            let frame_limit = (DSP_BLOCK / usize::from(self.source_channels.max(1))).max(1);
            let mut stereo = Vec::with_capacity(frame_limit * 2);
            for _ in 0..frame_limit {
                let mut frame = Vec::with_capacity(usize::from(self.source_channels));
                for _ in 0..self.source_channels {
                    match self.decoder.next() {
                        Some(sample) => {
                            frame.push(sample);
                            self.decoded_frames = self.decoded_frames.saturating_add(1);
                        }
                        None => {
                            self.drained = true;
                            break;
                        }
                    }
                }
                if frame.is_empty() {
                    break;
                }
                let left = frame[0];
                let right = frame.get(1).copied().unwrap_or(left);
                stereo.extend([left, right]);
                if self.drained {
                    break;
                }
            }
            if stereo.is_empty() {
                break;
            }
            let output = self
                .dsp
                .lock()
                .map_err(|_| AudioError::DspLockPoisoned)?
                .process(&stereo)?;
            if let Some(spectrum) = &self.spectrum {
                spectrum.queue(&output);
            }
            self.processed.extend(output);
        }
        Ok(())
    }

    pub fn read(&mut self, out: &mut [f32]) -> usize {
        self.read_samples(out).unwrap_or(0)
    }

    pub fn decoded_frames(&self) -> u64 {
        self.base_decoded_frames + self.decoded_frames / u64::from(self.source_channels.max(1))
    }

    pub fn set_observers(&mut self, spectrum: SharedSpectrum) {
        self.spectrum = Some(spectrum);
    }

    pub fn shared_dsp(&self) -> SharedDsp {
        Arc::clone(&self.dsp)
    }

    pub fn update_settings(&mut self, settings: DspSettings) {
        if let Ok(mut dsp) = self.dsp.lock() {
            dsp.update_settings(settings);
        }
    }

    fn read_samples(&mut self, out: &mut [f32]) -> Result<usize, AudioError> {
        let mut written = 0;
        while written < out.len() {
            if self.processed.is_empty() {
                self.fill()?;
                if self.processed.is_empty() {
                    break;
                }
            }
            let (front, _) = self.processed.as_slices();
            let count = front.len().min(out.len() - written);
            out[written..written + count].copy_from_slice(&front[..count]);
            self.processed.drain(..count);
            written += count;
        }
        Ok(written)
    }
}

impl Iterator for LocalTrack {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let mut sample = [0.0];
        (self.read_samples(&mut sample).ok()? == 1).then_some(sample[0])
    }
}

impl Source for LocalTrack {
    fn current_span_len(&self) -> Option<usize> {
        self.decoder.current_span_len()
    }
    fn channels(&self) -> rodio::ChannelCount {
        2
    }
    fn sample_rate(&self) -> rodio::SampleRate {
        self.source_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        self.decoder.total_duration()
    }
    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let duration = self.decoder.total_duration();
        let seek_to = duration.map_or(pos, |duration| pos.min(duration));
        self.decoder.try_seek(seek_to)?;
        self.processed.clear();
        self.drained = false;
        if let Ok(mut dsp) = self.dsp.lock() {
            dsp.reset();
        }
        if let Some(spectrum) = &self.spectrum {
            spectrum.clear_if_enabled();
        }
        self.decoded_frames = 0;
        self.base_decoded_frames =
            (seek_to.as_secs_f64() * f64::from(self.source_rate)).round() as u64;
        Ok(())
    }
}
