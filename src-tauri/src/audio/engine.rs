use crossbeam_channel::{bounded, Receiver, Sender};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use tracing::{error, info, warn};

use super::decoder::TrackDecoder;
use super::output::AudioOutput;

#[derive(Clone, Copy)]
pub struct BiquadFilter {
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

impl BiquadFilter {
    pub fn new_peaking(sample_rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
        if gain_db.abs() < 0.05 {
            return Self::identity();
        }
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * w0.cos();
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * w0.cos();
        let a2 = 1.0 - alpha / a;

        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    pub fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    #[inline(always)]
    pub fn process(&mut self, input: f32) -> f32 {
        let out = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = out;
        out
    }
}

pub enum AudioCommand {
    Play {
        track_id: i64,
        path: PathBuf,
        start_ms: u64,
    },
    Pause,
    Resume,
    Seek(u64),
    Stop,
    SetVolume(f32),
    SetEq([f32; 10]),
    SetCrossfade(u32),
}

pub struct AudioEngine {
    cmd_tx: Sender<AudioCommand>,
    pub is_playing: Arc<AtomicBool>,
    pub current_track_id: Arc<AtomicI64>,
    pub position_ms: Arc<AtomicI64>,
    pub duration_ms: Arc<AtomicI64>,
    pub volume_bits: Arc<AtomicU32>,
}

impl AudioEngine {
    pub fn start() -> Self {
        let (cmd_tx, cmd_rx) = bounded::<AudioCommand>(32);
        let is_playing = Arc::new(AtomicBool::new(false));
        let current_track_id = Arc::new(AtomicI64::new(-1));
        let position_ms = Arc::new(AtomicI64::new(0));
        let duration_ms = Arc::new(AtomicI64::new(0));
        let volume_bits = Arc::new(AtomicU32::new(1.0f32.to_bits()));

        let is_p = Arc::clone(&is_playing);
        let cur_id = Arc::clone(&current_track_id);
        let pos_ms = Arc::clone(&position_ms);
        let dur_ms = Arc::clone(&duration_ms);
        let vol_b = Arc::clone(&volume_bits);

        thread::Builder::new()
            .name("sonus-audio-engine".to_string())
            .spawn(move || {
                run_engine_loop(cmd_rx, is_p, cur_id, pos_ms, dur_ms, vol_b);
            })
            .expect("Failed to spawn audio engine thread");

        Self {
            cmd_tx,
            is_playing,
            current_track_id,
            position_ms,
            duration_ms,
            volume_bits,
        }
    }

    pub fn play(&self, track_id: i64, path: PathBuf, start_ms: u64) {
        let _ = self.cmd_tx.send(AudioCommand::Play { track_id, path, start_ms });
    }

    pub fn pause(&self) {
        let _ = self.cmd_tx.send(AudioCommand::Pause);
    }

    pub fn resume(&self) {
        let _ = self.cmd_tx.send(AudioCommand::Resume);
    }

    pub fn seek(&self, ms: u64) {
        let _ = self.cmd_tx.send(AudioCommand::Seek(ms));
    }

    pub fn stop(&self) {
        let _ = self.cmd_tx.send(AudioCommand::Stop);
    }

    pub fn set_volume(&self, vol: f32) {
        let clamped = vol.clamp(0.0, 1.0);
        self.volume_bits.store(clamped.to_bits(), Ordering::Relaxed);
        let _ = self.cmd_tx.send(AudioCommand::SetVolume(clamped));
    }

    pub fn set_eq(&self, bands: [f32; 10]) {
        let _ = self.cmd_tx.send(AudioCommand::SetEq(bands));
    }
}

fn run_engine_loop(
    cmd_rx: Receiver<AudioCommand>,
    is_playing: Arc<AtomicBool>,
    current_track_id: Arc<AtomicI64>,
    position_ms: Arc<AtomicI64>,
    duration_ms: Arc<AtomicI64>,
    volume_bits: Arc<AtomicU32>,
) {
    let (sample_tx, sample_rx) = bounded::<f32>(16384);
    let output = AudioOutput::try_create(sample_rx);
    let hw_sample_rate = match output {
        Ok((_, sr)) => sr,
        Err(e) => {
            error!("Audio device init failed: {}", e);
            44100
        }
    };

    let mut decoder: Option<TrackDecoder> = None;
    let mut decode_chunk = Vec::with_capacity(4096);
    let mut chunk_pos = 0;
    let mut frames_played = 0u64;
    let mut current_sr = 44100u32;
    let eq_freqs = [31.0, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
    let mut eq_left: Vec<BiquadFilter> = eq_freqs.iter().map(|&f| BiquadFilter::new_peaking(hw_sample_rate as f32, f, 0.0, 1.41)).collect();
    let mut eq_right: Vec<BiquadFilter> = eq_freqs.iter().map(|&f| BiquadFilter::new_peaking(hw_sample_rate as f32, f, 0.0, 1.41)).collect();

    loop {
        // Drain pending commands
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                AudioCommand::Play { track_id, path, start_ms } => {
                    info!("Loading track {} from {:?}", track_id, path);
                    match TrackDecoder::open(&path) {
                        Ok(mut dec) => {
                            if start_ms > 0 {
                                let _ = dec.seek(start_ms);
                            }
                            current_sr = dec.sample_rate;
                            duration_ms.store(dec.duration_ms as i64, Ordering::Relaxed);
                            current_track_id.store(track_id, Ordering::Relaxed);
                            frames_played = (start_ms * current_sr as u64) / 1000;
                            position_ms.store(start_ms as i64, Ordering::Relaxed);
                            decode_chunk.clear();
                            chunk_pos = 0;
                            decoder = Some(dec);
                            is_playing.store(true, Ordering::Relaxed);
                        }
                        Err(e) => {
                            warn!("Corrupt or unreadable audio file {:?}: {}", path, e);
                            decoder = None;
                            is_playing.store(false, Ordering::Relaxed);
                        }
                    }
                }
                AudioCommand::Pause => {
                    is_playing.store(false, Ordering::Relaxed);
                }
                AudioCommand::Resume => {
                    if decoder.is_some() {
                        is_playing.store(true, Ordering::Relaxed);
                    }
                }
                AudioCommand::Seek(ms) => {
                    if let Some(dec) = &mut decoder {
                        if dec.seek(ms).is_ok() {
                            decode_chunk.clear();
                            chunk_pos = 0;
                            frames_played = (ms * current_sr as u64) / 1000;
                            position_ms.store(ms as i64, Ordering::Relaxed);
                        }
                    }
                }
                AudioCommand::Stop => {
                    decoder = None;
                    is_playing.store(false, Ordering::Relaxed);
                    current_track_id.store(-1, Ordering::Relaxed);
                    position_ms.store(0, Ordering::Relaxed);
                }
                AudioCommand::SetVolume(v) => {
                    volume_bits.store(v.to_bits(), Ordering::Relaxed);
                }
                AudioCommand::SetEq(bands) => {
                    for i in 0..10 {
                        eq_left[i] = BiquadFilter::new_peaking(hw_sample_rate as f32, eq_freqs[i], bands[i], 1.41);
                        eq_right[i] = BiquadFilter::new_peaking(hw_sample_rate as f32, eq_freqs[i], bands[i], 1.41);
                    }
                }
                AudioCommand::SetCrossfade(_) => {}
            }
        }

        if !is_playing.load(Ordering::Relaxed) || decoder.is_none() {
            thread::sleep(std::time::Duration::from_millis(15));
            continue;
        }

        let dec = decoder.as_mut().unwrap();

        // Feed samples into ring buffer
        if chunk_pos >= decode_chunk.len() {
            decode_chunk.clear();
            chunk_pos = 0;
            match dec.decode_next_stereo_chunk(&mut decode_chunk) {
                Ok(has_more) => {
                    if !has_more || decode_chunk.is_empty() {
                        // Track completed
                        decoder = None;
                        is_playing.store(false, Ordering::Relaxed);
                        continue;
                    }
                }
                Err(e) => {
                    warn!("Decode packet error: {:?}", e);
                    decoder = None;
                    is_playing.store(false, Ordering::Relaxed);
                    continue;
                }
            }
        }

        let vol = f32::from_bits(volume_bits.load(Ordering::Relaxed));

        while chunk_pos + 1 < decode_chunk.len() {
            let mut left = decode_chunk[chunk_pos] * vol;
            let mut right = decode_chunk[chunk_pos + 1] * vol;

            for eq in eq_left.iter_mut() {
                left = eq.process(left);
            }
            for eq in eq_right.iter_mut() {
                right = eq.process(right);
            }

            if sample_tx.try_send(left).is_err() {
                break;
            }
            let _ = sample_tx.try_send(right);

            chunk_pos += 2;
            frames_played += 1;

            if frames_played % (current_sr as u64 / 10) == 0 {
                let ms = (frames_played * 1000) / (current_sr as u64);
                position_ms.store(ms as i64, Ordering::Relaxed);
            }
        }

        thread::sleep(std::time::Duration::from_millis(5));
    }
}
