export interface EqPreset {
  id: string;
  name: string;
  bands: number[];
  isCustom?: boolean;
}

export const SPOTIFY_EQ_PRESETS: EqPreset[] = [
  { id: "flat", name: "Flat", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "acoustic", name: "Acoustic", bands: [3, 2, 1, 1, 1, 1, 2, 3, 3, 2] },
  { id: "bass_booster", name: "Bass Booster (+6dB)", bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: "bass_booster_high", name: "Bass Booster (High +12dB)", bands: [12, 10, 7, 3, 0, 0, 0, 0, 0, 0] },
  { id: "bass_booster_extreme", name: "Bass Booster (Extreme +18dB)", bands: [18, 15, 10, 4, 0, 0, 0, 0, 0, 0] },
  { id: "bass_booster_maximum", name: "Bass Booster (Maximum +24dB)", bands: [24, 20, 14, 5, 0, 0, 0, 0, 0, 0] },
  { id: "bass_reducer", name: "Bass Reducer", bands: [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0] },
  { id: "classical", name: "Classical", bands: [4, 3, 2, 2, -1, -1, 0, 2, 3, 3] },
  { id: "dance", name: "Dance", bands: [5, 4, 2, 0, 0, -2, 0, 2, 4, 5] },
  { id: "deep", name: "Deep", bands: [4, 3, 2, 1, 0, -1, -1, -2, -3, -4] },
  { id: "electronic", name: "Electronic", bands: [4, 3, 1, 0, -2, 2, 1, 2, 4, 4] },
  { id: "hip_hop", name: "Hip-Hop", bands: [5, 4, 2, 1, -1, -1, 1, -1, 2, 3] },
  { id: "jazz", name: "Jazz", bands: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: "latin", name: "Latin", bands: [3, 2, 0, 0, -1, -1, -1, 1, 3, 4] },
  { id: "loudness", name: "Loudness", bands: [5, 4, 0, -2, -3, -1, 0, -2, 4, 3] },
  { id: "lounge", name: "Lounge", bands: [-3, -2, 0, 2, 3, 2, 0, -1, 2, 1] },
  { id: "piano", name: "Piano", bands: [2, 1, 0, 2, 3, 2, 3, 4, 3, 2] },
  { id: "pop", name: "Pop", bands: [-1, 1, 3, 4, 4, 3, 1, -1, -1, -1] },
  { id: "r_and_b", name: "R&B", bands: [3, 6, 4, 1, -2, -1, 2, 3, 3, 4] },
  { id: "rock", name: "Rock", bands: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4] },
  { id: "small_speakers", name: "Small Speakers", bands: [5, 4, 3, 2, 1, 0, -1, -2, -3, -4] },
  { id: "spoken_word", name: "Spoken Word", bands: [-4, -2, 0, 1, 4, 4, 3, 1, -1, -3] },
  { id: "treble_booster", name: "Treble Booster", bands: [0, 0, 0, 0, 0, 1, 2, 3, 5, 6] },
  { id: "treble_reducer", name: "Treble Reducer", bands: [0, 0, 0, 0, 0, -1, -2, -3, -5, -6] },
  { id: "vocal_booster", name: "Vocal Booster", bands: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
];

export function matchEqPreset(bands: number[], customPresets: EqPreset[] = []): string {
  for (const preset of [...customPresets, ...SPOTIFY_EQ_PRESETS]) {
    if (preset.bands.every((val, i) => val === (bands[i] ?? 0))) {
      return preset.id;
    }
  }
  return "custom";
}
