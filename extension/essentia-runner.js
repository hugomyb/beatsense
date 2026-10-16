// Tempo and key computation with essentia.js.
// Loaded in the background page (Firefox) or in the sandbox page (Chrome: the only page where
// Manifest V3 allows the Function() that essentia.js needs).
//
// Settings chosen on 58 type beats whose description gives BPM and key:
// - key over the whole track, "edmm" profile: 76% exact keys (64% with "bgate" on 2 min)
// - tempo over 2 min in the middle, "degara" method: as accurate as "multifeature", 6x faster in WASM
const RUNNER_RATE = 44100;
const TEMPO_SECONDS = 120;

let essentiaInstance = null;

function analyzeSamples(samples) {
  essentiaInstance ??= new Essentia(exports.EssentiaWASM);
  const span = Math.min(samples.length, TEMPO_SECONDS * RUNNER_RATE);
  const start = Math.floor((samples.length - span) / 2);
  const middle = essentiaInstance.arrayToVector(samples.subarray(start, start + span));
  const full = essentiaInstance.arrayToVector(samples);
  try {
    const { bpm } = essentiaInstance.RhythmExtractor2013(middle, 208, "degara", 40);
    const k = essentiaInstance.KeyExtractor(full, true, 4096, 4096, 12, 3500, 60, 25, 0.2, "edmm", RUNNER_RATE);
    return { bpm, key: k.key, scale: k.scale, strength: k.strength };
  } finally {
    // WASM memory, not freed by the garbage collector
    middle.delete();
    full.delete();
  }
}
