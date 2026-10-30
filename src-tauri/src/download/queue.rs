use std::sync::Arc;
use tokio::sync::Semaphore;

pub struct DownloadQueue {
    semaphore: Arc<Semaphore>,
}

impl DownloadQueue {
    pub fn new() -> Self {
        Self {
            semaphore: Arc::new(Semaphore::new(1)),
        }
    }

    pub fn semaphore(&self) -> Arc<Semaphore> {
        Arc::clone(&self.semaphore)
    }
}

impl Default for DownloadQueue {
    fn default() -> Self {
        Self::new()
    }
}
