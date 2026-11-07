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
    b0: f64, b1: f64, b2: f64,
    a1: f64, a2: f64,
    x1: f64, x2: f64,
    y1: f64, y2: f64,
}

impl BiquadFilter {
    pub fn new_peaking(sample_rate: f64, freq: f64, gain_db: f64, q: f64) -> Self {
        if gain_db.abs() < 0.05 {
            return Self::identity();
        }
        let a = 10.0f64.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f64::consts::PI * freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);

        let (b0, b1, b2) = (1.0 + alpha * a, -2.0 * w0.cos(), 1.0 - alpha * a);
        let (a0, a1, a2) = (1.0 + alpha / a, -2.0 * w0.cos(), 1.0 - alpha / a);

        Self {
            b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
            a1: a1 / a0, a2: a2 / a0,
            x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0,
        }
    }

    pub fn identity() -> Self {
        Self {
            b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0,
            x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0,
        }
    }

    #[inline(always)]
    pub fn process(&mut self, input: f32) -> f32 {
        let x0 = input as f64;
        let mut out = self.b0 * x0 + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1 - self.a2 * self.y2;
        if out.abs() < 1e-15 {
            out = 0.0;
        }
        self.x2 = self.x1;
        self.x1 = x0;
        self.y2 = self.y1;
        self.y1 = out;
        out as f32
    }
}

#[inline(always)]
fn soft_limit(x: f32) -> f32 {
    let abs = x.abs();
    if abs <= 0.82 {
        x
    } else {
        let sign = if x < 0.0 { -1.0 } else { 1.0 };
        let excess = abs - 0.82;
        sign * (0.82 + 0.17 * (excess / 0.17).tanh())
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
    SetSpeed(f32),
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
    pub speed_bits: Arc<AtomicU32>,
}

impl AudioEngine {
    pub fn start() -> Self {
        let (cmd_tx, cmd_rx) = bounded::<AudioCommand>(32);
        let is_playing = Arc::new(AtomicBool::new(false));
        let current_track_id = Arc::new(AtomicI64::new(-1));
        let position_ms = Arc::new(AtomicI64::new(0));
        let duration_ms = Arc::new(AtomicI64::new(0));
        let volume_bits = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let speed_bits = Arc::new(AtomicU32::new(1.0f32.to_bits()));

        let is_p = Arc::clone(&is_playing);
        let cur_id = Arc::clone(&current_track_id);
        let pos_ms = Arc::clone(&position_ms);
        let dur_ms = Arc::clone(&duration_ms);
        let vol_b = Arc::clone(&volume_bits);
        let spd_b = Arc::clone(&speed_bits);

        thread::Builder::new()
            .name("sonus-audio-engine".to_string())
            .spawn(move || {
                run_engine_loop(cmd_rx, is_p, cur_id, pos_ms, dur_ms, vol_b, spd_b);
            })
            .expect("Failed to spawn audio engine thread");

        Self {
            cmd_tx,
            is_playing,
            current_track_id,
            position_ms,
            duration_ms,
            volume_bits,
            speed_bits,
        }
    }

    pub fn play(&self, track_id: i64, path: PathBuf, start_ms: u64) {
        let _ = self.cmd_tx.send(AudioCommand::Play { track_id, path, start_ms });
    }

    pub fn pause(&self) {
        self.is_playing.store(false, Ordering::Relaxed);
        let _ = self.cmd_tx.send(AudioCommand::Pause);
    }

    pub fn resume(&self) {
        self.is_playing.store(true, Ordering::Relaxed);
        let _ = self.cmd_tx.send(AudioCommand::Resume);
    }

    pub fn seek(&self, ms: u64) {
        let _ = self.cmd_tx.send(AudioCommand::Seek(ms));
    }

    pub fn stop(&self) {
        self.is_playing.store(false, Ordering::Relaxed);
        let _ = self.cmd_tx.send(AudioCommand::Stop);
    }

    pub fn stop_and_wait(&self) {
        self.is_playing.store(false, Ordering::Relaxed);
        let _ = self.cmd_tx.send(AudioCommand::Stop);
        for _ in 0..25 {
            if self.current_track_id.load(Ordering::Relaxed) == -1 {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(20));
        }
        thread::sleep(std::time::Duration::from_millis(30));
    }

    pub fn set_volume(&self, vol: f32) {
        let clamped = vol.clamp(0.0, 2.0);
        self.volume_bits.store(clamped.to_bits(), Ordering::Relaxed);
        let _ = self.cmd_tx.send(AudioCommand::SetVolume(clamped));
    }

    pub fn set_speed(&self, speed: f32) {
        let clamped = speed.clamp(0.1, 2.5);
        self.speed_bits.store(clamped.to_bits(), Ordering::Relaxed);
        let _ = self.cmd_tx.send(AudioCommand::SetSpeed(clamped));
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
    speed_bits: Arc<AtomicU32>,
) {
    let (sample_tx, sample_rx) = bounded::<[f32; 2]>(16384);
    let output = AudioOutput::try_create(sample_rx);
    let hw_sample_rate = match output {
        Ok((_, sr)) => sr,
        Err(e) => {
            error!("Audio device init failed: {}", e);
            44100
        }
    };

    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" {
            fn SetThreadPriority(thread: *mut std::ffi::c_void, priority: i32) -> i32;
            fn GetCurrentThread() -> *mut std::ffi::c_void;
            fn timeBeginPeriod(uPeriod: u32) -> u32;
        }
        timeBeginPeriod(1);
        SetThreadPriority(GetCurrentThread(), 2);
    }

    let mut decoder: Option<TrackDecoder> = None;
    let mut decode_chunk = Vec::with_capacity(4096);
    let mut current_sr = 44100u32;
    let mut frac_pos = 0.0f64;
    let mut source_frames_played = 0.0f64;
    let mut eq_headroom = 1.0f32;
    let mut fade_in_frames = 0usize;

    let eq_freqs = [31.0f64, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
    let mut eq_left: Vec<BiquadFilter> = eq_freqs.iter().map(|&f| BiquadFilter::new_peaking(hw_sample_rate as f64, f, 0.0, 1.41)).collect();
    let mut eq_right: Vec<BiquadFilter> = eq_freqs.iter().map(|&f| BiquadFilter::new_peaking(hw_sample_rate as f64, f, 0.0, 1.41)).collect();

    loop {
        // Drain pending commands
        while let Ok(cmd) = cmd_rx.try_recv() {
            match cmd {
                AudioCommand::Play { track_id, path, start_ms } => {
                    info!("Loading track {} from {:?}", track_id, path);
                    match TrackDecoder::open(&path) {
                        Ok(mut dec) => {
                            if start_ms > 0 { let _ = dec.seek(start_ms); }
                            current_sr = dec.sample_rate;
                            duration_ms.store(dec.duration_ms as i64, Ordering::Relaxed);
                            current_track_id.store(track_id, Ordering::Relaxed);
                            source_frames_played = (start_ms as f64 * current_sr as f64) / 1000.0;
                            position_ms.store(start_ms as i64, Ordering::Relaxed);
                            decode_chunk.clear();
                            frac_pos = 0.0;
                            decoder = Some(dec);
                            is_playing.store(true, Ordering::Relaxed);
                            fade_in_frames = 256;
                        }
                        Err(e) => {
                            warn!("Corrupt or unreadable audio file {:?}: {}", path, e);
                            decoder = None;
                            is_playing.store(false, Ordering::Relaxed);
                        }
                    }
                }
                AudioCommand::Pause => { is_playing.store(false, Ordering::Relaxed); }
                AudioCommand::Resume => { if decoder.is_some() { is_playing.store(true, Ordering::Relaxed); fade_in_frames = 256; } }
                AudioCommand::Seek(ms) => {
                    if let Some(dec) = &mut decoder {
                        if dec.seek(ms).is_ok() {
                            decode_chunk.clear();
                            frac_pos = 0.0;
                            source_frames_played = (ms as f64 * current_sr as f64) / 1000.0;
                            position_ms.store(ms as i64, Ordering::Relaxed);
                            fade_in_frames = 256;
                        }
                    }
                }
                AudioCommand::Stop => {
                    decoder = None;
                    decode_chunk.clear();
                    decode_chunk.shrink_to(4096);
                    is_playing.store(false, Ordering::Relaxed);
                    current_track_id.store(-1, Ordering::Relaxed);
                    position_ms.store(0, Ordering::Relaxed);
                }
                AudioCommand::SetVolume(v) => { volume_bits.store(v.to_bits(), Ordering::Relaxed); }
                AudioCommand::SetSpeed(s) => { speed_bits.store(s.to_bits(), Ordering::Relaxed); }
                AudioCommand::SetEq(bands) => {
                    let max_gain = bands.iter().copied().fold(0.0f32, f32::max);
                    eq_headroom = if max_gain > 0.0 {
                        10.0f32.powf(-max_gain * 0.35 / 20.0)
                    } else {
                        1.0
                    };
                    for i in 0..10 {
                        eq_left[i] = BiquadFilter::new_peaking(hw_sample_rate as f64, eq_freqs[i], bands[i] as f64, 1.41);
                        eq_right[i] = BiquadFilter::new_peaking(hw_sample_rate as f64, eq_freqs[i], bands[i] as f64, 1.41);
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

        // Ensure we have decoded frames to resample from without losing fractional position
        let in_frames = decode_chunk.len() / 2;
        if frac_pos + 1.0 >= in_frames as f64 {
            let consumed = (frac_pos.floor() as usize).min(in_frames);
            if consumed > 0 {
                decode_chunk.drain(0..consumed * 2);
                frac_pos -= consumed as f64;
                source_frames_played += consumed as f64;
            }
            let remaining_frames = decode_chunk.len() / 2;

            match dec.decode_next_stereo_chunk(&mut decode_chunk) {
                Ok(has_more) => {
                    if !has_more && (decode_chunk.len() / 2) <= remaining_frames {
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

        let updated_in_frames = decode_chunk.len() / 2;
        if updated_in_frames < 2 {
            thread::sleep(std::time::Duration::from_millis(4));
            continue;
        }

        let raw_speed = f32::from_bits(speed_bits.load(Ordering::Relaxed)).clamp(0.1, 2.5) as f64;
        let ratio = (current_sr as f64 / hw_sample_rate as f64) * raw_speed;
        let raw_vol = f32::from_bits(volume_bits.load(Ordering::Relaxed));
        let norm = (raw_vol / 2.0).clamp(0.0, 1.0);
        let vol = (norm * norm) * 0.48;

        // Generate output frames at hw_sample_rate via linear interpolation
        while frac_pos + 1.0 < updated_in_frames as f64 {
            let idx = frac_pos as usize;
            let alpha = (frac_pos - idx as f64) as f32;

            let l0 = decode_chunk[idx * 2];
            let r0 = decode_chunk[idx * 2 + 1];
            let l1 = decode_chunk[(idx + 1) * 2];
            let r1 = decode_chunk[(idx + 1) * 2 + 1];

            let mut left = (l0 + alpha * (l1 - l0)) * vol * eq_headroom;
            let mut right = (r0 + alpha * (r1 - r0)) * vol * eq_headroom;
            if fade_in_frames > 0 {
                let ramp = 1.0 - (fade_in_frames as f32 / 256.0);
                left *= ramp; right *= ramp; fade_in_frames -= 1;
            }

            for eq in eq_left.iter_mut() { left = eq.process(left); }
            for eq in eq_right.iter_mut() { right = eq.process(right); }

            let out_l = soft_limit(left);
            let out_r = soft_limit(right);

            if sample_tx.try_send([out_l, out_r]).is_err() { break; }

            frac_pos += ratio;
        }

        let buffered_source_frames = (sample_tx.len() as f64) * ratio;
        let actual_source_frames = (source_frames_played + frac_pos - buffered_source_frames).max(0.0);
        let ms = ((actual_source_frames * 1000.0) / (current_sr as f64)) as u64;
        position_ms.store(ms as i64, Ordering::Relaxed);

        let dur = duration_ms.load(Ordering::Relaxed);
        if dur > 0 && ms >= dur as u64 {
            decoder = None;
            is_playing.store(false, Ordering::Relaxed);
        }

        let q = sample_tx.len();
        if q >= 12000 {
            thread::sleep(std::time::Duration::from_millis(25));
        } else if q >= 5000 {
            thread::sleep(std::time::Duration::from_millis(10));
        } else if q >= 1500 {
            thread::sleep(std::time::Duration::from_millis(3));
        } else {
            thread::sleep(std::time::Duration::from_millis(1));
        }
    }
}
