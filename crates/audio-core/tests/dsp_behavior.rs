use audio_core::{DspProcessor, DspSettings, EQ_FREQUENCIES};
use std::f32::consts::TAU;

const SAMPLE_RATE: f32 = 44_100.0;

fn tone(frequency: f32, seconds: f32) -> Vec<f32> {
    let frames = (SAMPLE_RATE * seconds) as usize;
    (0..frames)
        .flat_map(|frame| {
            let value = (TAU * frequency * frame as f32 / SAMPLE_RATE).sin() * 0.5;
            [value, value]
        })
        .collect()
}

fn crossings_per_second(samples: &[f32]) -> f32 {
    let frames = samples.len() / 2;
    let crossings = (1..frames)
        .filter(|frame| samples[(frame - 1) * 2] <= 0.0 && samples[frame * 2] > 0.0)
        .count();
    crossings as f32 * SAMPLE_RATE / frames as f32
}

#[test]
fn neutral_settings_leave_samples_untouched() {
    let mut processor = DspProcessor::new(DspSettings::default());
    let input = tone(440.0, 0.2);
    assert_eq!(processor.process(&input).unwrap(), input);
}

#[test]
fn equalizer_uses_the_six_legacy_centres() {
    assert_eq!(
        EQ_FREQUENCIES,
        [60.0, 150.0, 400.0, 1_000.0, 2_400.0, 15_000.0]
    );
}

#[test]
fn tempo_and_pitch_limits_are_sanitized() {
    let settings = DspSettings {
        gains_db: [40.0; 6],
        tempo: 12.0,
        pitch_semitones: f32::NAN,
        preserves_pitch: true,
    }
    .sanitized();
    assert_eq!(settings.gains_db[0], 12.0);
    assert_eq!(settings.tempo, 2.0);
    assert_eq!(settings.pitch_semitones, 0.0);
}

#[test]
fn half_tempo_preserves_pitch_and_doubles_duration() {
    let mut processor = DspProcessor::new(DspSettings {
        tempo: 0.5,
        ..DspSettings::default()
    });
    let mut output = Vec::new();
    for _ in 0..40 {
        output.extend(processor.process(&tone(440.0, 0.05)).unwrap());
    }
    let ratio = output.len() as f32 / (40.0 * SAMPLE_RATE * 0.05 * 2.0);
    assert!((ratio - 2.0).abs() < 0.08, "duration ratio was {ratio}");
    let measured = crossings_per_second(&output);
    assert!((measured - 440.0).abs() < 20.0, "pitch was {measured} Hz");
}

#[test]
fn disabling_pitch_preservation_changes_pitch_with_tempo() {
    let mut processor = DspProcessor::new(DspSettings {
        tempo: 0.5,
        preserves_pitch: false,
        ..DspSettings::default()
    });
    let mut output = Vec::new();
    for _ in 0..20 {
        output.extend(processor.process(&tone(440.0, 0.05)).unwrap());
    }
    let measured = crossings_per_second(&output);
    assert!((measured - 220.0).abs() < 10.0, "pitch was {measured} Hz");
}

#[test]
fn an_octave_shift_keeps_track_duration_when_pitch_is_preserved() {
    let mut processor = DspProcessor::new(DspSettings {
        pitch_semitones: 12.0,
        ..DspSettings::default()
    });
    let mut output = Vec::new();
    for _ in 0..40 {
        output.extend(processor.process(&tone(440.0, 0.05)).unwrap());
    }
    let ratio = output.len() as f32 / (40.0 * SAMPLE_RATE * 0.05 * 2.0);
    assert!((ratio - 1.0).abs() < 0.08, "duration ratio was {ratio}");
    let measured = crossings_per_second(&output);
    assert!((measured - 880.0).abs() < 40.0, "pitch was {measured} Hz");
}

#[test]
fn a_boosted_equalizer_band_does_not_boost_an_unselected_band() {
    let mut gains = [0.0; 6];
    gains[0] = 12.0;
    let mut boosted = DspProcessor::new(DspSettings {
        gains_db: gains,
        ..DspSettings::default()
    });
    let bass = boosted.process(&tone(EQ_FREQUENCIES[0], 0.5)).unwrap();
    let high = boosted.process(&tone(EQ_FREQUENCIES[5], 0.5)).unwrap();
    let mut flat = DspProcessor::new(DspSettings::default());
    let high_reference = flat.process(&tone(EQ_FREQUENCIES[5], 0.5)).unwrap();
    let mean_square = |samples: &[f32]| {
        let settled = &samples[samples.len() / 2..];
        settled.iter().map(|sample| sample * sample).sum::<f32>() / settled.len() as f32
    };
    assert!(mean_square(&bass) > mean_square(&high) * 4.0);
    assert!(
        (mean_square(&high) - mean_square(&high_reference)).abs()
            < mean_square(&high_reference) * 0.25
    );
}

#[test]
fn incomplete_stereo_frames_are_rejected() {
    let mut processor = DspProcessor::new(DspSettings::default());
    assert_eq!(
        processor.process(&[0.25]),
        Err(audio_core::DspError::IncompleteStereoFrame)
    );
}
