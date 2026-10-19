use audio_core::{DspSettings, LocalTrack};
use rodio::Source;
use std::f32::consts::TAU;
use std::fs;
use std::path::Path;
use std::time::Duration;

fn write_wav(path: &Path, frames: usize, rate: u32) {
    write_wav_format(path, frames, rate, 16);
}

fn write_wav_format(path: &Path, frames: usize, rate: u32, bits: u16) {
    let bytes_per_sample = usize::from(bits / 8);
    let mut data = Vec::with_capacity(frames * 2 * bytes_per_sample);
    for frame in 0..frames {
        let sample = (TAU * 440.0 * frame as f32 / rate as f32).sin() * 0.5;
        let encoded = match bits {
            8 => vec![(sample * 127.0 + 128.0).round() as u8],
            16 => ((sample * i16::MAX as f32).round() as i16)
                .to_le_bytes()
                .to_vec(),
            24 => {
                let value = (sample * 8_388_607.0).round() as i32;
                value.to_le_bytes()[..3].to_vec()
            }
            32 => (sample * i32::MAX as f32).round().to_le_bytes().to_vec(),
            _ => panic!("unsupported test WAV bit depth"),
        };
        data.extend_from_slice(&encoded);
        data.extend_from_slice(&encoded);
    }
    let block_align = (2 * bytes_per_sample) as u16;
    let mut body = Vec::new();
    body.extend_from_slice(b"WAVE");
    body.extend_from_slice(b"fmt ");
    body.extend_from_slice(&16_u32.to_le_bytes());
    body.extend_from_slice(&1_u16.to_le_bytes());
    body.extend_from_slice(&2_u16.to_le_bytes());
    body.extend_from_slice(&rate.to_le_bytes());
    body.extend_from_slice(&(rate * u32::from(block_align)).to_le_bytes());
    body.extend_from_slice(&block_align.to_le_bytes());
    body.extend_from_slice(&bits.to_le_bytes());
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
fn pcm_wav_integer_depths_and_common_sample_rates_decode_to_finite_stereo() {
    for (bits, rate) in [(8, 22_050), (16, 44_100), (24, 48_000), (32, 96_000)] {
        let frames = (rate / 20) as usize;
        let path = std::env::temp_dir().join(format!(
            "resonance-pcm-{bits}-{rate}-{}.wav",
            std::process::id()
        ));
        write_wav_format(&path, frames, rate, bits);
        let track = LocalTrack::open(&path, DspSettings::default()).unwrap();
        assert_eq!(track.sample_rate(), rate, "{bits}-bit {rate} Hz");
        let duration_ms = (frames as u64 * 1_000 / u64::from(rate)) as i64;
        let actual_ms = track.total_duration().unwrap().as_millis() as i64;
        assert!((actual_ms - duration_ms).abs() <= 1, "{bits}-bit {rate} Hz");
        let samples: Vec<f32> = track.collect();
        assert_eq!(samples.len(), frames * 2, "{bits}-bit {rate} Hz");
        assert!(samples.iter().all(|sample| sample.is_finite()));
        assert!(samples.iter().any(|sample| sample.abs() > 0.01));
        fs::remove_file(path).unwrap();
    }
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
    assert_eq!(track.decoded_frames(), 4_410 + 2_048);

    fs::remove_file(path).unwrap();
}

#[test]
fn missing_local_files_return_an_error() {
    let path = std::env::temp_dir().join(format!("resonance-missing-{}.flac", std::process::id()));
    assert!(LocalTrack::open(&path, DspSettings::default()).is_err());
}
