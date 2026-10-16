// Code shared by Firefox and Chrome: local server, audio decoding, cache and panel actions.
// Uses keyLabel() from settings.js, loaded before.
// Firefox loads it in its background page, Chrome in its service worker and offscreen document.
globalThis.browser ??= chrome;

const SERVER = "http://127.0.0.1:7843";
const SAMPLE_RATE = 44100;
// Increment when the analysis changes, so old results are not served again
const CACHE_PREFIX = "analysis-v2:";

// Camelot wheel (notation used by Tunebat and DJs)
const CAMELOT = {
  "Ab minor": "1A", "B major": "1B", "Eb minor": "2A", "F# major": "2B",
  "Bb minor": "3A", "C# major": "3B", "F minor": "4A", "Ab major": "4B",
  "C minor": "5A", "Eb major": "5B", "G minor": "6A", "Bb major": "6B",
  "D minor": "7A", "F major": "7B", "A minor": "8A", "C major": "8B",
  "E minor": "9A", "G major": "9B", "B minor": "10A", "D major": "10B",
  "F# minor": "11A", "A major": "11B", "C# minor": "12A", "E major": "12B",
};
// Essentia may output sharps where the wheel uses flats
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
    throw new ServerError("BeatSense server unreachable: is it running on this computer?");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ServerError(data.error || `Error ${res.status}`);
  }
  return res;
}

async function decodeMono(arrayBuffer) {
  // decodeAudioData resamples to the context rate: essentia expects 44.1 kHz
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
    // Classic half/double tempo ambiguity (140 BPM trap detected at 70, etc.)
    bpm_alt: rounded < 90 ? rounded * 2 : rounded > 160 ? Math.round(rounded / 2) : null,
    key,
    scale,
    key_label: `${key} ${scale === "major" ? "Major" : "Minor"}`,
    camelot: CAMELOT[`${key} ${scale}`] ?? "",
    confidence: Math.round(strength * 100) / 100,
  };
}

// analyzeSamples: mono 44.1 kHz Float32Array -> { bpm, key, scale, strength } (essentia-runner.js)
async function fetchAndAnalyze(videoId, analyzeSamples) {
  const meta = await (await server("/fetch", { video_id: videoId })).json();
  const audio = await (await server(`/audio/${videoId}`)).arrayBuffer();
  return { ...meta, ...describe(await analyzeSamples(await decodeMono(audio))) };
}

// analyze: videoId -> full result; the cache and the actions are identical on both browsers
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
    async download(videoId, { notation }) {
      const a = await analyzeOnce(videoId);
      // Same notation as the panel; "/" is forbidden in a file name
      const label = keyLabel(a.key, a.scale, notation, "-");
      const res = await server("/download", { video_id: videoId, bpm: a.bpm, key_label: label });
      return { ...a, ...(await res.json()) };
    },
    "open-folder": () => server("/open-folder", {}).then(() => ({})),
  };
}

function errorMessage(e) {
  return e instanceof ServerError ? e.message : `Analysis failed: ${e?.message ?? e}`;
}

// sendResponse rather than a returned promise: the only form accepted by both browsers
function listen(actions) {
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const { action, videoId, target } = msg;
    if (target || !actions[action]) return false; // message meant for the offscreen document (Chrome)
    actions[action](videoId, msg).then(
      (data) => sendResponse({ ok: true, data }),
      (e) => {
        console.error("[BeatSense]", e);
        sendResponse({ ok: false, error: errorMessage(e) });
      },
    );
    return true;
  });
}
