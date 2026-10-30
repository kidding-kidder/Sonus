use std::path::Path;
use symphonia::core::audio::AudioBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub struct TrackDecoder {
    pub reader: Box<dyn FormatReader>,
    pub decoder: Box<dyn Decoder>,
    pub track_id: u32,
    pub sample_rate: u32,
    pub channels: usize,
}

impl TrackDecoder {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
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

        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &decoder_opts)
            .map_err(|e| e.to_string())?;

        Ok(Self {
            reader,
            decoder,
            track_id,
            sample_rate,
            channels,
        })
    }

    pub fn next_packet_samples(&mut self) -> Result<Option<AudioBuffer<f32>>, SymphoniaError> {
        let packet = match self.reader.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(None);
            }
            Err(e) => return Err(e),
        };

        if packet.track_id() != self.track_id {
            return Ok(None);
        }

        let decoded = self.decoder.decode(&packet)?;
        let mut sample_buf = AudioBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        decoded.convert(&mut sample_buf);
        Ok(Some(sample_buf))
    }
}
