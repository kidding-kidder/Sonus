use std::path::Path;
use symphonia::core::audio::{AudioBuffer, Signal};
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

pub struct TrackDecoder {
    pub reader: Box<dyn FormatReader>,
    pub decoder: Box<dyn Decoder>,
    pub track_id: u32,
    pub sample_rate: u32,
    pub channels: usize,
    pub duration_ms: u64,
    sample_buf: Option<AudioBuffer<f32>>,
}

impl TrackDecoder {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let file = {
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(7)
                    .open(&path)
                    .map_err(|e| e.to_string())?
            }
            #[cfg(not(windows))]
            {
                std::fs::File::open(&path).map_err(|e| e.to_string())?
            }
        };
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let hint = Hint::new();
        let format_opts = FormatOptions::default();
        let metadata_opts = MetadataOptions::default();
        let decoder_opts = DecoderOptions::default();

        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .map_err(|e| e.to_string())?;

        let reader = probed.format;
        let track = reader
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| "No supported audio tracks found".to_string())?;

        let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
        let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);
        let track_id = track.id;

        let duration_ms = if let Some(n_frames) = track.codec_params.n_frames {
            (n_frames * 1000) / (sample_rate as u64)
        } else {
            0
        };

        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &decoder_opts)
            .map_err(|e| e.to_string())?;

        Ok(Self {
            reader,
            decoder,
            track_id,
            sample_rate,
            channels,
            duration_ms,
            sample_buf: None,
        })
    }

    pub fn seek(&mut self, time_ms: u64) -> Result<(), String> {
        let seconds = time_ms / 1000;
        let frac = (time_ms % 1000) as f64 / 1000.0;
        let time = Time::new(seconds, frac);
        let target = SeekTo::Time {
            time,
            track_id: Some(self.track_id),
        };

        if self.reader.seek(SeekMode::Accurate, target).is_err() {
            self.reader
                .seek(
                    SeekMode::Coarse,
                    SeekTo::Time {
                        time,
                        track_id: Some(self.track_id),
                    },
                )
                .map_err(|e| e.to_string())?;
        }

        self.decoder.reset();
        Ok(())
    }

    pub fn decode_next_stereo_chunk(&mut self, out: &mut Vec<f32>) -> Result<bool, SymphoniaError> {
        let packet = match self.reader.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(false);
            }
            Err(e) => return Err(e),
        };

        if packet.track_id() != self.track_id {
            return Ok(true);
        }

        let decoded = self.decoder.decode(&packet)?;
        let cap = decoded.capacity() as u64;
        let spec = *decoded.spec();

        let need_new_buf = match &self.sample_buf {
            Some(buf) => (buf.capacity() as u64) < cap || *buf.spec() != spec,
            None => true,
        };
        if need_new_buf {
            self.sample_buf = Some(AudioBuffer::<f32>::new(cap, spec));
        }

        let sample_buf = self.sample_buf.as_mut().unwrap();
        decoded.convert(sample_buf);

        let frames = sample_buf.frames();
        let chan_count = sample_buf.spec().channels.count();
        out.reserve(frames * 2);

        if chan_count == 1 {
            let mono = sample_buf.chan(0);
            for &s in &mono[..frames] {
                out.push(s);
                out.push(s);
            }
        } else {
            let left = sample_buf.chan(0);
            let right = sample_buf.chan(1.min(chan_count - 1));
            for i in 0..frames {
                out.push(left[i]);
                out.push(right[i]);
            }
        }

        Ok(true)
    }
}
