// Page de fond : récupère l'audio via le serveur local (yt-dlp) et l'analyse ici avec essentia.js.
// Le content script ne peut pas joindre localhost directement (CORS de la page YouTube).
const SERVER = "http://127.0.0.1:7843";
const SAMPLE_RATE = 44100;
// 2 min au milieu du morceau suffisent pour le tempo et la tonalité, et divisent le temps de calcul
const ANALYSIS_SECONDS = 120;

// Roue Camelot (notation utilisée par Tunebat et les DJ)
const CAMELOT = {
  "Ab minor": "1A", "B major": "1B", "Eb minor": "2A", "F# major": "2B",
  "Bb minor": "3A", "C# major": "3B", "F minor": "4A", "Ab major": "4B",
  "C minor": "5A", "Eb major": "5B", "G minor": "6A", "Bb major": "6B",
  "D minor": "7A", "F major": "7B", "A minor": "8A", "C major": "8B",
  "E minor": "9A", "G major": "9B", "B minor": "10A", "D major": "10B",
  "F# minor": "11A", "A major": "11B", "C# minor": "12A", "E major": "12B",
};
// Essentia peut sortir des dièses là où la roue utilise des bémols
const ENHARMONIC = { "G#": "Ab", "D#": "Eb", "A#": "Bb", Db: "C#", Gb: "F#" };

let essentia = null;
const inFlight = new Map();

class ServerError extends Error {}

async function server(path, body) {
  let res;
  try {
    res = await fetch(`${SERVER}${path}`, body && {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ServerError("Serveur BeatSense injoignable : est-il lancé sur ce PC ?");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ServerError(data.error || `Erreur ${res.status}`);
  }
  return res;
}

async function decodeMono(arrayBuffer) {
  // decodeAudioData rééchantillonne à la fréquence du contexte : 44,1 kHz attendus par essentia
  const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(arrayBuffer);
  const span = Math.min(audio.length, ANALYSIS_SECONDS * SAMPLE_RATE);
  const start = Math.floor((audio.length - span) / 2);
  const mono = new Float32Array(span);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c).subarray(start, start + span);
    for (let i = 0; i < span; i++) mono[i] += data[i] / audio.numberOfChannels;
  }
  return mono;
}

function analyze(samples) {
  essentia ??= new Essentia(exports.EssentiaWASM);
  const vector = essentia.arrayToVector(samples);
  try {
    // "degara" : mêmes BPM que "multifeature" sur nos tests, 6x plus rapide en WASM
    const { bpm } = essentia.RhythmExtractor2013(vector, 208, "degara", 40);
    const k = essentia.KeyExtractor(vector, true, 4096, 4096, 12, 3500, 60, 25, 0.2, "bgate", SAMPLE_RATE);
    const key = ENHARMONIC[k.key] ?? k.key;
    const rounded = Math.round(bpm);
    return {
      bpm: rounded,
      bpm_exact: Math.round(bpm * 100) / 100,
      // Ambiguïté classique demi/double tempo (trap à 140 détectée à 70, etc.)
      bpm_alt: rounded < 90 ? rounded * 2 : rounded > 160 ? Math.round(rounded / 2) : null,
      key,
      scale: k.scale,
      key_label: `${key} ${k.scale === "major" ? "Major" : "Minor"}`,
      camelot: CAMELOT[`${key} ${k.scale}`] ?? "",
      confidence: Math.round(k.strength * 100) / 100,
    };
  } finally {
    vector.delete(); // mémoire WASM, pas libérée par le ramasse-miettes
  }
}

async function analyzeVideo(videoId) {
  const cacheKey = `analysis:${videoId}`;
  const stored = (await browser.storage.local.get(cacheKey))[cacheKey];
  if (stored) return stored;

  const meta = await (await server("/fetch", { video_id: videoId })).json();
  const audio = await (await server(`/audio/${videoId}`)).arrayBuffer();
  const result = { ...meta, ...analyze(await decodeMono(audio)) };
  await browser.storage.local.set({ [cacheKey]: result });
  return result;
}

function analyzeOnce(videoId) {
  if (!inFlight.has(videoId)) {
    inFlight.set(videoId, analyzeVideo(videoId).finally(() => inFlight.delete(videoId)));
  }
  return inFlight.get(videoId);
}

const actions = {
  analyze: (videoId) => analyzeOnce(videoId),
  async download(videoId) {
    const a = await analyzeOnce(videoId);
    const res = await server("/download", { video_id: videoId, bpm: a.bpm, key_label: a.key_label });
    return { ...a, ...(await res.json()) };
  },
  "open-folder": () => server("/open-folder", {}).then(() => ({})),
};

browser.runtime.onMessage.addListener(async ({ action, videoId }) => {
  try {
    return { ok: true, data: await actions[action](videoId) };
  } catch (e) {
    console.error("[BeatSense]", e);
    return { ok: false, error: e instanceof ServerError ? e.message : `Analyse impossible : ${e.message ?? e}` };
  }
});
