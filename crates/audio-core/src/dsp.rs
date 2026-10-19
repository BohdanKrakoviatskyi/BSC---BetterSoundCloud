use std::f32::consts::TAU;
use std::sync::{Arc, Mutex};
use thiserror::Error;

const CHANNELS: usize = 2;
const SAMPLE_RATE: f32 = 44_100.0;
const FILTER_Q: f32 = 0.9;
const MAX_GAIN_DB: f32 = 12.0;
const WSOLA_FRAME: usize = 1_024;
const WSOLA_HOP: usize = WSOLA_FRAME / 2;
const WSOLA_SEARCH: isize = 256;
const WSOLA_COARSE_STEP: isize = 4;
const INPUT_COMPACT_LIMIT: usize = WSOLA_FRAME * 4;

pub const EQ_BAND_COUNT: usize = 6;
pub const EQ_FREQUENCIES: [f32; EQ_BAND_COUNT] = [60.0, 150.0, 400.0, 1_000.0, 2_400.0, 15_000.0];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DspError {
    #[error("interleaved audio must contain complete stereo frames")]
    IncompleteStereoFrame,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DspSettings {
    pub gains_db: [f32; EQ_BAND_COUNT],
    pub tempo: f32,
    pub pitch_semitones: f32,
    pub preserves_pitch: bool,
}

impl Default for DspSettings {
    fn default() -> Self {
        Self {
            gains_db: [0.0; EQ_BAND_COUNT],
            tempo: 1.0,
            pitch_semitones: 0.0,
            preserves_pitch: true,
        }
    }
}

impl DspSettings {
    pub fn sanitized(mut self) -> Self {
        for gain in &mut self.gains_db {
            *gain = if gain.is_finite() {
                gain.clamp(-MAX_GAIN_DB, MAX_GAIN_DB)
            } else {
                0.0
            };
        }
        self.tempo = if self.tempo.is_finite() {
            self.tempo.clamp(0.5, 2.0)
        } else {
            1.0
        };
        self.pitch_semitones = if self.pitch_semitones.is_finite() {
            self.pitch_semitones.clamp(-12.0, 12.0)
        } else {
            0.0
        };
        self
    }

    fn resampling_ratio(self) -> f32 {
        let pitch_ratio = 2.0_f32.powf(self.pitch_semitones / 12.0);
        if self.preserves_pitch {
            pitch_ratio
        } else {
            pitch_ratio * self.tempo
        }
    }

    fn time_stretch_ratio(self) -> f32 {
        self.resampling_ratio() / self.tempo
    }
}

pub struct DspProcessor {
    settings: DspSettings,
    equalizers: [ChannelEqualizer; CHANNELS],
    resampler: LinearResampler,
    stretcher: WsolaStretcher,
}

pub type SharedDsp = Arc<Mutex<DspProcessor>>;

impl DspProcessor {
    pub fn new(settings: DspSettings) -> Self {
        let settings = settings.sanitized();
        Self {
            settings,
            equalizers: std::array::from_fn(|_| ChannelEqualizer::new(settings.gains_db)),
            resampler: LinearResampler::default(),
            stretcher: WsolaStretcher::new(),
        }
    }

    pub fn settings(&self) -> DspSettings {
        self.settings
    }

    pub fn update_settings(&mut self, settings: DspSettings) {
        let settings = settings.sanitized();
        if settings.gains_db != self.settings.gains_db {
            for channel in &mut self.equalizers {
                channel.retune(settings.gains_db);
            }
        }
        self.settings = settings;
    }

    pub fn reset(&mut self) {
        self.resampler = LinearResampler::default();
        self.stretcher = WsolaStretcher::new();
        for channel in &mut self.equalizers {
            channel.clear_history();
        }
    }

    pub fn process(&mut self, samples: &[f32]) -> Result<Vec<f32>, DspError> {
        if !samples.len().is_multiple_of(CHANNELS) {
            return Err(DspError::IncompleteStereoFrame);
        }
        if self.settings == DspSettings::default() {
            return Ok(samples.to_vec());
        }

        let mut processed = samples.to_vec();
        if self.settings.gains_db.iter().any(|gain| gain.abs() > 0.01) {
            for (index, sample) in processed.iter_mut().enumerate() {
                *sample = self.equalizers[index % CHANNELS].process(*sample);
            }
        }

        let resampling = self.settings.resampling_ratio();
        if (resampling - 1.0).abs() > 1e-4 {
            processed = self.resampler.process(&processed, resampling);
        }

        let stretching = self.settings.time_stretch_ratio();
        if (stretching - 1.0).abs() > 1e-4 {
            processed = self.stretcher.process(&processed, stretching);
        }
        Ok(processed)
    }
}

#[derive(Clone, Copy, Default)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn peak(frequency: f32, gain_db: f32) -> Self {
        let amplitude = 10.0_f32.powf(gain_db / 40.0);
        let omega = TAU * frequency / SAMPLE_RATE;
        let (sin, cos) = omega.sin_cos();
        let alpha = sin / (2.0 * FILTER_Q);
        let scale = 1.0 + alpha / amplitude;
        Self {
            b0: (1.0 + alpha * amplitude) / scale,
            b1: -2.0 * cos / scale,
            b2: (1.0 - alpha * amplitude) / scale,
            a1: -2.0 * cos / scale,
            a2: (1.0 - alpha / amplitude) / scale,
            ..Self::default()
        }
    }

    fn run(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;
        output
    }

    fn set_coefficients(&mut self, source: Self) {
        self.b0 = source.b0;
        self.b1 = source.b1;
        self.b2 = source.b2;
        self.a1 = source.a1;
        self.a2 = source.a2;
    }
}

struct ChannelEqualizer {
    bands: [Biquad; EQ_BAND_COUNT],
    active: bool,
}

impl ChannelEqualizer {
    fn new(gains: [f32; EQ_BAND_COUNT]) -> Self {
        let mut equalizer = Self {
            bands: [Biquad::default(); EQ_BAND_COUNT],
            active: false,
        };
        equalizer.retune(gains);
        equalizer
    }

    fn retune(&mut self, gains: [f32; EQ_BAND_COUNT]) {
        self.active = gains.iter().any(|gain| gain.abs() > 0.01);
        for ((band, frequency), gain) in self.bands.iter_mut().zip(EQ_FREQUENCIES).zip(gains) {
            band.set_coefficients(Biquad::peak(frequency, gain));
        }
    }

    fn clear_history(&mut self) {
        for band in &mut self.bands {
            band.x1 = 0.0;
            band.x2 = 0.0;
            band.y1 = 0.0;
            band.y2 = 0.0;
        }
    }

    fn process(&mut self, sample: f32) -> f32 {
        if !self.active {
            return sample;
        }
        self.bands
            .iter_mut()
            .fold(sample, |value, band| band.run(value))
    }
}

#[derive(Default)]
struct LinearResampler {
    next_position: f32,
    previous_frame: [f32; CHANNELS],
    has_previous: bool,
}

impl LinearResampler {
    fn process(&mut self, input: &[f32], ratio: f32) -> Vec<f32> {
        let frames = input.len() / CHANNELS;
        if frames == 0 {
            return Vec::new();
        }
        if !self.has_previous {
            self.previous_frame.copy_from_slice(&input[..CHANNELS]);
            self.has_previous = true;
        }
        let mut output = Vec::with_capacity((frames as f32 / ratio) as usize * CHANNELS + CHANNELS);
        while self.next_position < frames as f32 {
            let lower = self.next_position.floor() as usize;
            let fraction = self.next_position - lower as f32;
            for channel in 0..CHANNELS {
                let from = if lower == 0 {
                    self.previous_frame[channel]
                } else {
                    input[(lower - 1) * CHANNELS + channel]
                };
                let to = input[lower * CHANNELS + channel];
                output.push(from + (to - from) * fraction);
            }
            self.next_position += ratio;
        }
        self.next_position -= frames as f32;
        self.previous_frame
            .copy_from_slice(&input[(frames - 1) * CHANNELS..frames * CHANNELS]);
        output
    }
}

struct WsolaStretcher {
    pending: Vec<f32>,
    overlap_tail: Vec<f32>,
    window: [f32; WSOLA_FRAME],
    analysis_position: f64,
}

impl WsolaStretcher {
    fn new() -> Self {
        let window = std::array::from_fn(|index| {
            let phase = TAU * index as f32 / WSOLA_FRAME as f32;
            0.5 - 0.5 * phase.cos()
        });
        Self {
            pending: Vec::new(),
            overlap_tail: vec![0.0; (WSOLA_FRAME - WSOLA_HOP) * CHANNELS],
            window,
            analysis_position: WSOLA_SEARCH as f64,
        }
    }

    fn process(&mut self, samples: &[f32], ratio: f32) -> Vec<f32> {
        self.pending.extend_from_slice(samples);
        let analysis_hop = (WSOLA_HOP as f64 / ratio as f64).max(1.0);
        let overlap = WSOLA_FRAME - WSOLA_HOP;
        let mut output = Vec::with_capacity(samples.len());

        loop {
            let centre = self.analysis_position.floor() as isize;
            let last_needed = centre + WSOLA_SEARCH + WSOLA_FRAME as isize;
            if centre < WSOLA_SEARCH || last_needed as usize * CHANNELS > self.pending.len() {
                break;
            }

            let start = self.best_join(centre, overlap);
            for frame in 0..overlap {
                let base = frame * CHANNELS;
                for channel in 0..CHANNELS {
                    output.push(
                        self.overlap_tail[base + channel]
                            + self.pending[(start as usize + frame) * CHANNELS + channel]
                                * self.window[frame],
                    );
                }
            }
            for frame in 0..overlap {
                let input_frame = start as usize + WSOLA_HOP + frame;
                let base = frame * CHANNELS;
                for channel in 0..CHANNELS {
                    self.overlap_tail[base + channel] = self.pending
                        [input_frame * CHANNELS + channel]
                        * self.window[WSOLA_HOP + frame];
                }
            }

            self.analysis_position += analysis_hop;
            let discard = (self.analysis_position.floor() as isize - WSOLA_SEARCH).max(0) as usize;
            if discard >= INPUT_COMPACT_LIMIT {
                self.pending.drain(..discard * CHANNELS);
                self.analysis_position -= discard as f64;
            }
        }
        output
    }

    fn best_join(&self, centre: isize, overlap: usize) -> isize {
        let score = |offset| self.correlate(offset, overlap, WSOLA_COARSE_STEP as usize);
        let mut best = centre;
        let mut best_score = f32::NEG_INFINITY;
        let mut offset = -WSOLA_SEARCH;
        while offset <= WSOLA_SEARCH {
            let candidate = centre + offset;
            let candidate_score = score(candidate);
            if candidate_score > best_score {
                best = candidate;
                best_score = candidate_score;
            }
            offset += WSOLA_COARSE_STEP;
        }
        for candidate in (best - WSOLA_COARSE_STEP + 1)..(best + WSOLA_COARSE_STEP) {
            if (centre - WSOLA_SEARCH..=centre + WSOLA_SEARCH).contains(&candidate) {
                let candidate_score = self.correlate(candidate, overlap, 1);
                if candidate_score > best_score {
                    best = candidate;
                    best_score = candidate_score;
                }
            }
        }
        best
    }

    fn correlate(&self, start: isize, overlap: usize, stride: usize) -> f32 {
        if start < 0 {
            return f32::NEG_INFINITY;
        }
        (0..overlap)
            .step_by(stride)
            .map(|frame| {
                self.pending[(start as usize + frame) * CHANNELS]
                    * self.overlap_tail[frame * CHANNELS]
            })
            .sum()
    }
}
