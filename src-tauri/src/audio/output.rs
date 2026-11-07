use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use crossbeam_channel::Receiver;
use tracing::{error, info, warn};

pub struct AudioOutput {
    _stream: Option<Stream>,
    pub sample_rate: u32,
    pub channels: u16,
}

impl AudioOutput {
    pub fn try_create(
        rx: Receiver<[f32; 2]>,
    ) -> Result<(Self, u32), String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default audio output device available".to_string())?;

        let device_name = device.name().unwrap_or_else(|_| "Default Device".to_string());
        info!("Initializing audio output on device: {}", device_name);

        let config: StreamConfig = device
            .default_output_config()
            .map_err(|e| e.to_string())?
            .into();

        let sample_rate = config.sample_rate.0;
        let channels = config.channels;
        let ch = channels as usize;

        let err_fn = |err| {
            error!("Audio stream error: {:?}", err);
        };

        let stream = match device.default_output_config().map_err(|e| e.to_string())?.sample_format() {
            SampleFormat::F32 => {
                let mut last_l = 0.0f32;
                let mut last_r = 0.0f32;
                device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        let pull_next = |rx: &Receiver<[f32; 2]>, ll: &mut f32, lr: &mut f32| -> [f32; 2] {
                            match rx.try_recv() {
                                Ok(f) => { *ll = f[0]; *lr = f[1]; f },
                                Err(_) => {
                                    *ll *= 0.88; *lr *= 0.88;
                                    if ll.abs() < 1e-4 { *ll = 0.0; }
                                    if lr.abs() < 1e-4 { *lr = 0.0; }
                                    [*ll, *lr]
                                }
                            }
                        };
                        if ch == 2 {
                            for frame in data.chunks_exact_mut(2) {
                                let [l, r] = pull_next(&rx, &mut last_l, &mut last_r);
                                frame[0] = l;
                                frame[1] = r;
                            }
                        } else if ch == 1 {
                            for sample in data.iter_mut() {
                                let [l, r] = pull_next(&rx, &mut last_l, &mut last_r);
                                *sample = (l + r) * 0.5;
                            }
                        } else {
                            for frame in data.chunks_exact_mut(ch) {
                                let [l, r] = pull_next(&rx, &mut last_l, &mut last_r);
                                frame[0] = l;
                                frame[1] = r;
                                for extra in &mut frame[2..] { *extra = 0.0; }
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                let mut last_l = 0.0f32;
                let mut last_r = 0.0f32;
                device.build_output_stream(
                    &config,
                    move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                        let pull_next = |rx: &Receiver<[f32; 2]>, ll: &mut f32, lr: &mut f32| -> [f32; 2] {
                            match rx.try_recv() {
                                Ok(f) => { *ll = f[0]; *lr = f[1]; f },
                                Err(_) => {
                                    *ll *= 0.88; *lr *= 0.88;
                                    if ll.abs() < 1e-4 { *ll = 0.0; }
                                    if lr.abs() < 1e-4 { *lr = 0.0; }
                                    [*ll, *lr]
                                }
                            }
                        };
                        if ch == 2 {
                            for frame in data.chunks_exact_mut(2) {
                                let [l, r] = pull_next(&rx, &mut last_l, &mut last_r);
                                frame[0] = (l.clamp(-1.0, 1.0) * 32767.0) as i16;
                                frame[1] = (r.clamp(-1.0, 1.0) * 32767.0) as i16;
                            }
                        } else if ch == 1 {
                            for sample in data.iter_mut() {
                                let [l, r] = pull_next(&rx, &mut last_l, &mut last_r);
                                *sample = (((l + r) * 0.5).clamp(-1.0, 1.0) * 32767.0) as i16;
                            }
                        } else {
                            for frame in data.chunks_exact_mut(ch) {
                                let [l, r] = pull_next(&rx, &mut last_l, &mut last_r);
                                frame[0] = (l.clamp(-1.0, 1.0) * 32767.0) as i16;
                                if ch > 1 { frame[1] = (r.clamp(-1.0, 1.0) * 32767.0) as i16; }
                                for extra in &mut frame[2..] { *extra = 0; }
                            }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let mut last_l = 0.0f32;
                let mut last_r = 0.0f32;
                device.build_output_stream(
                    &config,
                    move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                        for frame in data.chunks_exact_mut(ch) {
                            let [l, r] = match rx.try_recv() {
                                Ok(f) => { last_l = f[0]; last_r = f[1]; f },
                                Err(_) => {
                                    last_l *= 0.88; last_r *= 0.88;
                                    if last_l.abs() < 1e-4 { last_l = 0.0; }
                                    if last_r.abs() < 1e-4 { last_r = 0.0; }
                                    [last_l, last_r]
                                }
                            };
                            frame[0] = ((l.clamp(-1.0, 1.0) * 0.5 + 0.5) * 65535.0) as u16;
                            if ch > 1 { frame[1] = ((r.clamp(-1.0, 1.0) * 0.5 + 0.5) * 65535.0) as u16; }
                            for extra in &mut frame[2..] { *extra = 32768; }
                        }
                    },
                    err_fn,
                    None,
                )
            }
            _ => return Err("Unsupported hardware sample format".to_string()),
        }
        .map_err(|e| format!("Failed to build CPAL output stream: {}", e))?;

        if let Err(e) = stream.play() {
            warn!("Warning starting audio stream: {}", e);
        }

        Ok((
            Self {
                _stream: Some(stream),
                sample_rate,
                channels,
            },
            sample_rate,
        ))
    }
}
