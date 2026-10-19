use crate::spectrum::SpectrumAnalyzer;
use crossbeam_channel::{Receiver, Sender, TrySendError, bounded};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
};

const CHUNK_SAMPLES: usize = 256 * 2;

struct Chunk {
    samples: Vec<f32>,
    generation: u64,
    sequence: u64,
}

#[derive(Clone)]
pub struct SharedSpectrum {
    levels: Arc<Mutex<Vec<f32>>>,
    enabled: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    sequence: Arc<AtomicU64>,
    sender: Sender<Chunk>,
}

impl Default for SharedSpectrum {
    fn default() -> Self {
        Self::new()
    }
}

impl SharedSpectrum {
    pub fn new() -> Self {
        let levels = Arc::new(Mutex::new(vec![0.0; 48]));
        let enabled = Arc::new(AtomicBool::new(false));
        let generation = Arc::new(AtomicU64::new(0));
        let sequence = Arc::new(AtomicU64::new(0));
        let (sender, receiver) = bounded::<Chunk>(1);
        let worker_levels = Arc::clone(&levels);
        let worker_enabled = Arc::clone(&enabled);
        let worker_generation = Arc::clone(&generation);
        let _ = thread::Builder::new()
            .name("resonance-spectrum".into())
            .spawn(move || worker(receiver, worker_levels, worker_enabled, worker_generation));
        Self {
            levels,
            enabled,
            generation,
            sequence,
            sender,
        }
    }
    pub fn set_enabled(&self, value: bool) {
        self.enabled.store(value, Ordering::Release);
        if !value {
            self.clear();
        }
    }
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }
    pub fn levels(&self) -> Vec<f32> {
        self.levels
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| vec![0.0; 48])
    }
    pub fn clear(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut levels) = self.levels.lock() {
            levels.fill(0.0);
        }
    }
    pub fn clear_if_enabled(&self) {
        if self.is_enabled() {
            self.clear();
        }
    }
    #[cfg(test)]
    fn try_queue_for_test(&self, samples: Vec<f32>) -> bool {
        let generation = self.generation.load(Ordering::Acquire);
        self.sender
            .try_send(Chunk {
                samples,
                generation,
                sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            })
            .is_ok()
    }
    pub fn queue(&self, samples: &[f32]) {
        if !self.is_enabled() {
            return;
        }
        let generation = self.generation.load(Ordering::Acquire);
        for samples in samples.chunks(CHUNK_SAMPLES) {
            let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
            match self.sender.try_send(Chunk {
                samples: samples.to_vec(),
                generation,
                sequence,
            }) {
                Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
            }
        }
    }
}

fn worker(
    receiver: Receiver<Chunk>,
    levels: Arc<Mutex<Vec<f32>>>,
    enabled: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
) {
    let mut analyzer = SpectrumAnalyzer::new();
    let mut analyzer_generation = 0;
    let mut previous_sequence = None;
    while let Ok(chunk) = receiver.recv() {
        let current = generation.load(Ordering::Acquire);
        if current != chunk.generation || !enabled.load(Ordering::Acquire) {
            continue;
        }
        if analyzer_generation != current {
            analyzer.clear();
            analyzer_generation = current;
            previous_sequence = None;
        }
        let frame_skip = previous_sequence
            .map(|previous: u64| chunk.sequence.wrapping_sub(previous).max(1))
            .unwrap_or(1);
        previous_sequence = Some(chunk.sequence);
        analyzer.push_interleaved_with_gain_and_skip(&chunk.samples, 1.0, frame_skip);
        if generation.load(Ordering::Acquire) == current && enabled.load(Ordering::Acquire) {
            if let Ok(mut published) = levels.lock() {
                published.copy_from_slice(analyzer.levels());
            }
        } else {
            analyzer.clear();
            previous_sequence = None;
            analyzer_generation = generation.load(Ordering::Acquire);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_worker_queue_drops_when_full() {
        let spectrum = SharedSpectrum::new();
        spectrum.set_enabled(true);
        assert!(spectrum.try_queue_for_test(vec![0.0; CHUNK_SAMPLES]));
        assert!(!spectrum.try_queue_for_test(vec![0.0; CHUNK_SAMPLES]));
    }
    #[test]
    fn disabling_spectrum_clears_published_levels() {
        let spectrum = SharedSpectrum::new();
        spectrum.set_enabled(true);
        if let Ok(mut levels) = spectrum.levels.lock() {
            levels.fill(0.8);
        }
        spectrum.set_enabled(false);
        assert!(spectrum.levels().iter().all(|value| *value == 0.0));
    }

    #[test]
    fn sequence_numbers_include_dropped_chunks() {
        let (sender, receiver) = bounded::<Chunk>(1);
        let sequence = Arc::new(AtomicU64::new(0));
        let submit = || {
            let next = sequence.fetch_add(1, Ordering::Relaxed);
            sender.try_send(Chunk {
                samples: vec![],
                generation: 0,
                sequence: next,
            })
        };
        assert!(
            submit().is_ok()
        );
        assert!(submit().is_err());
        let received = receiver.try_recv().unwrap();
        assert_eq!(received.sequence, 0);
        assert!(submit().is_ok());
        let received = receiver.try_recv().unwrap();
        assert_eq!(received.sequence, 2);
    }
}
