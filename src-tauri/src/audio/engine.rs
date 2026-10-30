use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct AudioEngine {
    is_playing: Arc<AtomicBool>,
}

impl AudioEngine {
    pub fn new() -> Self {
        Self {
            is_playing: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_playing(&self) -> bool {
        self.is_playing.load(Ordering::Relaxed)
    }

    pub fn pause(&self) {
        self.is_playing.store(false, Ordering::Relaxed);
    }

    pub fn play(&self) {
        self.is_playing.store(true, Ordering::Relaxed);
    }
}

impl Default for AudioEngine {
    fn default() -> Self {
        Self::new()
    }
}
