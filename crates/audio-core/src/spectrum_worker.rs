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
}

#[derive(Clone)]
pub struct SharedSpectrum {
    levels: Arc<Mutex<Vec<f32>>>,
    enabled: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
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
            })
            .is_ok()
    }
    pub fn queue(&self, samples: &[f32]) {
        if !self.is_enabled() {
            return;
        }
        let generation = self.generation.load(Ordering::Acquire);
        for samples in samples.chunks(CHUNK_SAMPLES) {
            match self.sender.try_send(Chunk {
                samples: samples.to_vec(),
                generation,
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
    while let Ok(chunk) = receiver.recv() {
        let current = generation.load(Ordering::Acquire);
        if current != chunk.generation || !enabled.load(Ordering::Acquire) {
            continue;
        }
        analyzer.push_interleaved(&chunk.samples);
        if generation.load(Ordering::Acquire) == current && enabled.load(Ordering::Acquire) {
            if let Ok(mut published) = levels.lock() {
                published.copy_from_slice(analyzer.levels());
            }
        } else {
            analyzer.clear();
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
}
