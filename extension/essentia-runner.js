// Calcul du tempo et de la tonalité avec essentia.js.
// Chargé dans la page de fond (Firefox) ou dans la page sandbox (Chrome : seule page où
// Manifest V3 autorise le Function() dont essentia.js a besoin).
//
// Réglages choisis sur 58 type beats dont la description donne BPM et tonalité :
// - tonalité sur tout le morceau, profil "edmm" : 76 % de tonalités exactes (64 % avec "bgate" sur 2 min)
// - tempo sur 2 min au milieu, méthode "degara" : aussi juste que "multifeature", 6x plus rapide en WASM
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
    // mémoire WASM, pas libérée par le ramasse-miettes
    middle.delete();
    full.delete();
  }
}
