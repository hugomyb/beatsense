// Code commun Firefox / Chrome : serveur local, décodage audio, cache et actions du panneau.
// Firefox le charge dans sa page de fond, Chrome dans son service worker et son document offscreen.
globalThis.browser ??= chrome;

const SERVER = "http://127.0.0.1:7843";
const SAMPLE_RATE = 44100;
// Incrémenter quand l'analyse change, pour ne pas resservir d'anciens résultats
const CACHE_PREFIX = "analysis-v2:";

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
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
  }
  return mono;
}

function describe({ bpm, key, scale, strength }) {
  key = ENHARMONIC[key] ?? key;
  const rounded = Math.round(bpm);
  return {
    bpm: rounded,
    bpm_exact: Math.round(bpm * 100) / 100,
    // Ambiguïté classique demi/double tempo (trap à 140 détectée à 70, etc.)
    bpm_alt: rounded < 90 ? rounded * 2 : rounded > 160 ? Math.round(rounded / 2) : null,
    key,
    scale,
    key_label: `${key} ${scale === "major" ? "Major" : "Minor"}`,
    camelot: CAMELOT[`${key} ${scale}`] ?? "",
    confidence: Math.round(strength * 100) / 100,
  };
}

// analyzeSamples : Float32Array mono 44,1 kHz -> { bpm, key, scale, strength } (essentia-runner.js)
async function fetchAndAnalyze(videoId, analyzeSamples) {
  const meta = await (await server("/fetch", { video_id: videoId })).json();
  const audio = await (await server(`/audio/${videoId}`)).arrayBuffer();
  return { ...meta, ...describe(await analyzeSamples(await decodeMono(audio))) };
}

// analyze : videoId -> résultat complet ; le cache et les actions sont identiques sur les deux navigateurs
function createActions(analyze) {
  const inFlight = new Map();

  async function cachedAnalysis(videoId) {
    const cacheKey = CACHE_PREFIX + videoId;
    const stored = (await browser.storage.local.get(cacheKey))[cacheKey];
    if (stored) return stored;
    const result = await analyze(videoId);
    await browser.storage.local.set({ [cacheKey]: result });
    return result;
  }

  function analyzeOnce(videoId) {
    if (!inFlight.has(videoId)) {
      inFlight.set(videoId, cachedAnalysis(videoId).finally(() => inFlight.delete(videoId)));
    }
    return inFlight.get(videoId);
  }

  return {
    analyze: analyzeOnce,
    async download(videoId) {
      const a = await analyzeOnce(videoId);
      const res = await server("/download", { video_id: videoId, bpm: a.bpm, key_label: a.key_label });
      return { ...a, ...(await res.json()) };
    },
    "open-folder": () => server("/open-folder", {}).then(() => ({})),
  };
}

function errorMessage(e) {
  return e instanceof ServerError ? e.message : `Analyse impossible : ${e?.message ?? e}`;
}

// sendResponse plutôt qu'une promesse renvoyée : seule forme acceptée par les deux navigateurs
function listen(actions) {
  browser.runtime.onMessage.addListener(({ action, videoId, target }, _sender, sendResponse) => {
    if (target || !actions[action]) return false; // message destiné au document offscreen (Chrome)
    actions[action](videoId).then(
      (data) => sendResponse({ ok: true, data }),
      (e) => {
        console.error("[BeatSense]", e);
        sendResponse({ ok: false, error: errorMessage(e) });
      },
    );
    return true;
  });
}
