use rustfft::{Fft, FftPlanner, num_complex::Complex};
use std::f32::consts::TAU;
use std::sync::Arc;

pub const SPECTRUM_BAND_COUNT: usize = 48;
const SAMPLE_RATE: f32 = 44_100.0;
const MAIN_FFT: usize = 4096;
const BASS_FFT: usize = 8192;
const HOP: usize = 1024;
const MIN_HZ: f32 = 40.0;
const MAX_HZ: f32 = 16_000.0;
const BASS_CUTOFF_HZ: f32 = 100.0;

#[derive(Clone, Copy)]
enum FftResolution {
    Bass,
    Main,
}

#[derive(Clone, Copy)]
struct BandRange {
    lower_bin: usize,
    upper_bin: usize,
    resolution: FftResolution,
}

pub struct SpectrumAnalyzer {
    main_fft: Arc<dyn Fft<f32>>,
    bass_fft: Arc<dyn Fft<f32>>,
    main: Vec<Complex<f32>>,
    bass: Vec<Complex<f32>>,
    main_scratch: Vec<Complex<f32>>,
    bass_scratch: Vec<Complex<f32>>,
    main_window: Vec<f32>,
    bass_window: Vec<f32>,
    main_scale: f32,
    bass_scale: f32,
    ranges: [BandRange; SPECTRUM_BAND_COUNT],
    input: Vec<Complex<f32>>,
    levels: [f32; SPECTRUM_BAND_COUNT],
    reference: f32,
}

impl Default for SpectrumAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

impl SpectrumAnalyzer {
    pub fn new() -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let main_fft = planner.plan_fft_forward(MAIN_FFT);
        let bass_fft = planner.plan_fft_forward(BASS_FFT);
        let main_window = hann(MAIN_FFT);
        let bass_window = hann(BASS_FFT);
        let ranges = band_ranges();
        Self {
            main: vec![Complex::default(); MAIN_FFT],
            bass: vec![Complex::default(); BASS_FFT],
            main_scratch: vec![Complex::default(); main_fft.get_inplace_scratch_len()],
            bass_scratch: vec![Complex::default(); bass_fft.get_inplace_scratch_len()],
            main_scale: power_scale(&main_window),
            bass_scale: power_scale(&bass_window),
            main_window,
            bass_window,
            main_fft,
            bass_fft,
            ranges,
            input: vec![Complex::default(); BASS_FFT],
            levels: [0.0; SPECTRUM_BAND_COUNT],
            reference: 0.25,
        }
    }

    /// Analyze interleaved stereo PCM; chunks are treated as elapsed 1024-frame hops.
    pub fn push_interleaved(&mut self, samples: &[f32]) {
        for chunk in samples.chunks(HOP * 2) {
            let frames = (chunk.len() / 2).min(BASS_FFT);
            if frames == 0 {
                continue;
            }
            self.input.copy_within(..BASS_FFT - frames, frames);
            self.input[..frames].fill(Complex::default());
            for (index, pair) in chunk.as_chunks::<2>().0.iter().take(frames).enumerate() {
                let sanitize = |x: f32| {
                    if x.is_finite() {
                        x.clamp(-16.0, 16.0)
                    } else {
                        0.0
                    }
                };
                self.input[frames - index - 1] = Complex::new(sanitize(pair[0]), sanitize(pair[1]));
            }
            self.transform(frames as f32 / SAMPLE_RATE);
        }
    }

    pub fn levels(&self) -> &[f32; SPECTRUM_BAND_COUNT] {
        &self.levels
    }

    pub fn clear(&mut self) {
        self.input.fill(Complex::default());
        self.levels.fill(0.0);
        self.reference = 0.25;
    }

    fn transform(&mut self, elapsed: f32) {
        for i in 0..BASS_FFT {
            self.bass[i] = self.input[i] * self.bass_window[i];
        }
        for i in 0..MAIN_FFT {
            self.main[i] = self.input[i] * self.main_window[i];
        }
        self.bass_fft
            .process_with_scratch(&mut self.bass, &mut self.bass_scratch);
        self.main_fft
            .process_with_scratch(&mut self.main, &mut self.main_scratch);
        let mut amps = [0.0; SPECTRUM_BAND_COUNT];
        for (i, range) in self.ranges.iter().enumerate() {
            let (fft, scale): (&[Complex<f32>], f32) =
                if matches!(range.resolution, FftResolution::Bass) {
                    (&self.bass, self.bass_scale)
                } else {
                    (&self.main, self.main_scale)
                };
            let power: f32 = (range.lower_bin..=range.upper_bin)
                .map(|bin| (fft[bin].norm_sqr() + fft[fft.len() - bin].norm_sqr()) * 0.25)
                .sum();
            amps[i] = (power * scale).sqrt();
        }
        let strongest = amps.iter().copied().fold(0.0_f32, f32::max);
        if strongest > 0.005 {
            let target = strongest.max(0.08);
            let tc = if target > self.reference { 0.35 } else { 3.0 };
            self.reference += (target - self.reference) * (1.0 - (-elapsed / tc).exp());
        }
        let attack = 1.0 - (-elapsed / 0.008).exp();
        let release = 1.0 - (-elapsed / 0.065).exp();
        for (i, amp) in amps.into_iter().enumerate() {
            let relative = (amp - 0.0001).max(0.0) / self.reference;
            let target = 1.0 - (-1.8 * relative.powf(0.85)).exp();
            let alpha = if target > self.levels[i] {
                attack
            } else {
                release
            };
            self.levels[i] += (target - self.levels[i]) * alpha;
            if self.levels[i] < 0.0001 {
                self.levels[i] = 0.0;
            }
        }
    }
}

fn hann(size: usize) -> Vec<f32> {
    (0..size)
        .map(|i| 0.5 * (1.0 - (TAU * i as f32 / (size - 1) as f32).cos()))
        .collect()
}
fn power_scale(window: &[f32]) -> f32 {
    4.0 / (window.len() as f32 * window.iter().map(|x| x * x).sum::<f32>())
}

fn band_ranges() -> [BandRange; SPECTRUM_BAND_COUNT] {
    let mut lower_bins = [0; SPECTRUM_BAND_COUNT + 1];
    let mut upper_bins = [0; SPECTRUM_BAND_COUNT];
    let mut cutoff_frequencies = [0.0; SPECTRUM_BAND_COUNT + 1];
    let constant = (MIN_HZ / MAX_HZ).log10() / (1.0 / (SPECTRUM_BAND_COUNT + 1) as f32 - 1.0);
    let minimum_bandwidth = SAMPLE_RATE / BASS_FFT as f32;
    let mut bass_cutoff_band = 0;
    let mut first_bar = true;
    for edge in 0..=SPECTRUM_BAND_COUNT {
        let coefficient =
            -constant + (edge + 1) as f32 / (SPECTRUM_BAND_COUNT + 1) as f32 * constant;
        cutoff_frequencies[edge] = MAX_HZ * 10.0_f32.powf(coefficient);
        if edge > 0 && cutoff_frequencies[edge - 1] >= cutoff_frequencies[edge] {
            cutoff_frequencies[edge] = cutoff_frequencies[edge - 1] + minimum_bandwidth;
        }
        let relative = cutoff_frequencies[edge] / (SAMPLE_RATE / 2.0);
        if cutoff_frequencies[edge] < BASS_CUTOFF_HZ {
            lower_bins[edge] = ((relative * (BASS_FFT / 2) as f32) as usize).min(BASS_FFT / 2);
            bass_cutoff_band += 1;
            if bass_cutoff_band > 1 {
                first_bar = false;
            }
        } else {
            lower_bins[edge] =
                ((relative * (MAIN_FFT / 2) as f32).ceil() as usize).min(MAIN_FFT / 2);
            if edge == bass_cutoff_band {
                first_bar = true;
                if edge > 0 {
                    upper_bins[edge - 1] =
                        ((relative * (BASS_FFT / 2) as f32) as usize).saturating_sub(1);
                }
            } else {
                first_bar = false;
            }
        }
        if edge > 0 {
            if !first_bar {
                upper_bins[edge - 1] = lower_bins[edge].saturating_sub(1);
                if lower_bins[edge] <= lower_bins[edge - 1] {
                    let maximum = if edge < bass_cutoff_band {
                        BASS_FFT / 2
                    } else {
                        MAIN_FFT / 2
                    };
                    if lower_bins[edge - 1] < maximum {
                        lower_bins[edge] = lower_bins[edge - 1] + 1;
                        upper_bins[edge - 1] = lower_bins[edge] - 1;
                    }
                }
            } else if upper_bins[edge - 1] < lower_bins[edge - 1] {
                upper_bins[edge - 1] = lower_bins[edge - 1] + 1;
            }
        }
        let fft_size = if edge < bass_cutoff_band {
            BASS_FFT
        } else {
            MAIN_FFT
        };
        cutoff_frequencies[edge] =
            lower_bins[edge] as f32 / (fft_size / 2) as f32 * (SAMPLE_RATE / 2.0);
    }
    std::array::from_fn(|band| BandRange {
        lower_bin: lower_bins[band],
        upper_bin: upper_bins[band],
        resolution: if band < bass_cutoff_band {
            FftResolution::Bass
        } else {
            FftResolution::Main
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tone_activates_nearby_bands_and_silence_releases() {
        let mut analyzer = SpectrumAnalyzer::new();
        let samples: Vec<f32> = (0..HOP * 2 * 100)
            .flat_map(|n| {
                let x = (TAU * 1000.0 * n as f32 / SAMPLE_RATE).sin() * 0.7;
                [x, x]
            })
            .collect();
        analyzer.push_interleaved(&samples);
        assert!(analyzer.levels().iter().any(|x| *x > 0.3));
        let invalid = vec![f32::NAN; HOP * 2];
        analyzer.push_interleaved(&invalid);
        assert!(analyzer.levels().iter().all(|x| x.is_finite()));
        let silence = vec![0.0; HOP * 2 * 100];
        analyzer.push_interleaved(&silence);
        assert!(analyzer.levels().iter().all(|x| *x < 0.001));
    }

    #[test]
    fn uses_two_bass_bands_then_main_fft_resolution() {
        let ranges = band_ranges();
        let cutoff = ranges
            .iter()
            .position(|r| matches!(r.resolution, FftResolution::Main))
            .unwrap();
        assert_eq!(cutoff, 8);
        assert!(
            ranges[..cutoff]
                .iter()
                .all(|r| matches!(r.resolution, FftResolution::Bass))
        );
        assert!(
            ranges[cutoff..]
                .iter()
                .all(|r| matches!(r.resolution, FftResolution::Main))
        );
        assert_eq!(ranges[0].lower_bin, 7);
        assert_eq!(ranges[0].upper_bin, 7);
        assert_eq!(ranges[1].lower_bin, 8);
        assert_eq!(ranges[1].upper_bin, 8);
    }
}
