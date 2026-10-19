use audio_core::{DspSettings, LocalTrack};
use rodio::Source;
use std::f32::consts::TAU;
use std::fs;
use std::path::Path;
use std::time::Duration;

fn write_wav(path: &Path, frames: usize, rate: u32) {
    let mut data = Vec::with_capacity(frames * 2);
    for frame in 0..frames {
        let sample = (TAU * 440.0 * frame as f32 / rate as f32).sin() * 0.5;
        data.extend_from_slice(&((sample * i16::MAX as f32) as i16).to_le_bytes());
    }
    let mut body = Vec::new();
    body.extend_from_slice(b"WAVE");
    body.extend_from_slice(b"fmt ");
    body.extend_from_slice(&16_u32.to_le_bytes());
    body.extend_from_slice(&1_u16.to_le_bytes());
    body.extend_from_slice(&1_u16.to_le_bytes());
    body.extend_from_slice(&rate.to_le_bytes());
    body.extend_from_slice(&(rate * 2).to_le_bytes());
    body.extend_from_slice(&2_u16.to_le_bytes());
    body.extend_from_slice(&16_u16.to_le_bytes());
    body.extend_from_slice(b"data");
    body.extend_from_slice(&(data.len() as u32).to_le_bytes());
    body.extend_from_slice(&data);
    let mut file = Vec::new();
    file.extend_from_slice(b"RIFF");
    file.extend_from_slice(&(body.len() as u32).to_le_bytes());
    file.extend_from_slice(&body);
    fs::write(path, file).unwrap();
}

#[test]
fn local_wav_decodes_as_stereo_with_source_metadata() {
    let path = std::env::temp_dir().join(format!("resonance-audio-{}.wav", std::process::id()));
    write_wav(&path, 2_205, 44_100);
    let mut track = LocalTrack::open(&path, DspSettings::default()).unwrap();
    assert_eq!(track.channels(), 2);
    assert_eq!(track.sample_rate(), 44_100);
    assert_eq!(track.total_duration(), Some(Duration::from_millis(50)));
    let samples: Vec<f32> = track.by_ref().collect();
    assert_eq!(samples.len(), 4_410);
    assert_eq!(samples[0], samples[1]);
    fs::remove_file(path).unwrap();
}

#[test]
fn local_wav_source_can_seek_and_resume_from_the_requested_position() {
    let path = std::env::temp_dir().join(format!("resonance-seek-{}.wav", std::process::id()));
    write_wav(&path, 11_025, 44_100);
    let mut track = LocalTrack::open(&path, DspSettings::default()).unwrap();
    track.try_seek(Duration::from_millis(50)).unwrap();
    let mut first = [0.0; 2];
    assert_eq!(track.read(&mut first), 2);
    let expected = (TAU * 440.0 * 2_205.0 / 44_100.0).sin() * 0.5;
    assert!((first[0] - expected).abs() < 0.001);
    fs::remove_file(path).unwrap();
}

#[test]
fn decoded_position_counts_seek_offset_once_and_clamps_to_duration() {
    let path = std::env::temp_dir().join(format!("resonance-position-{}.wav", std::process::id()));
    write_wav(&path, 11_025, 44_100);
    let mut track = LocalTrack::open(&path, DspSettings::default()).unwrap();

    track.try_seek(Duration::from_millis(50)).unwrap();
    assert_eq!(track.decoded_frames(), 2_205);
    track.try_seek(Duration::from_millis(100)).unwrap();
    assert_eq!(track.decoded_frames(), 4_410);
    track.try_seek(Duration::from_secs(1)).unwrap();
    assert_eq!(track.decoded_frames(), 11_025);

    fs::remove_file(path).unwrap();
}

#[test]
fn local_decoder_reads_a_bounded_block_ahead() {
    let path =
        std::env::temp_dir().join(format!("resonance-read-ahead-{}.wav", std::process::id()));
    write_wav(&path, 11_025, 44_100);
    let mut track = LocalTrack::open(&path, DspSettings::default()).unwrap();
    track.try_seek(Duration::from_millis(100)).unwrap();

    let mut first_frame = [0.0; 2];
    assert_eq!(track.read(&mut first_frame), 2);
    assert_eq!(track.decoded_frames(), 4_410 + 4_096);

    fs::remove_file(path).unwrap();
}

#[test]
fn missing_local_files_return_an_error() {
    let path = std::env::temp_dir().join(format!("resonance-missing-{}.flac", std::process::id()));
    assert!(LocalTrack::open(&path, DspSettings::default()).is_err());
}
