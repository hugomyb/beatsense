// BeatSense panel injected under the video. YouTube is a SPA: we re-sync on every navigation.
// "instru" is kept on purpose: French-speaking producers title beats "instru" (functional, not displayed)
const PROD_TITLE = /type\s*beat|instru(mental)?|\bprod\b|\bbeat\b|\bfree\b.*\b(beat|prod)\b/i;

let settings = DEFAULT_SETTINGS;
let currentId = null;
let dismissedId = null; // video on which the panel was closed with the cross
const categories = new Map();

const videoIdFromUrl = () => {
  const url = new URL(location.href);
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const m = url.pathname.match(/^\/shorts\/([\w-]{11})/);
  return m ? m[1] : null;
};

const send = (action, videoId, extra = {}) => browser.runtime.sendMessage({ action, videoId, ...extra });

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// YouTube category of the video ("Music", "Gaming"...), always in English whatever the language.
function videoCategory(id) {
  if (location.hostname === "music.youtube.com") return Promise.resolve("Music");
  // The player already knows it, unless it has not loaded the new video yet
  const player = document.getElementById("movie_player")?.wrappedJSObject?.getPlayerResponse?.();
  if (player?.videoDetails?.videoId === id && player.microformat?.playerMicroformatRenderer?.category) {
    return Promise.resolve(player.microformat.playerMicroformatRenderer.category);
  }
  if (!categories.has(id)) {
    const category = fetch(`/watch?v=${id}`)
      .then((r) => r.text())
      .then((html) => html.match(/"category":"([^"]+)"/)?.[1] ?? null)
      .catch(() => null);
    categories.set(id, category);
  }
  return categories.get(id);
}

function buildPanel() {
  const panel = el("div", "pg-panel");
  panel.id = "beatsense-panel";

  const stats = el("div", "pg-stats");
  const bpm = el("div", "pg-stat");
  bpm.append(el("span", "pg-label", "BPM"), el("span", "pg-value pg-bpm", "–"), el("span", "pg-sub pg-bpm-alt", ""));
  const key = el("div", "pg-stat");
  key.append(el("span", "pg-label", "Key"), el("span", "pg-value pg-key", "–"), el("span", "pg-sub pg-camelot", ""));
  stats.append(bpm, key);

  const actions = el("div", "pg-actions");
  const analyzeBtn = el("button", "pg-btn pg-analyze", "Analyze");
  const dlBtn = el("button", "pg-btn pg-primary pg-download", "Download");
  const folderBtn = el("button", "pg-btn pg-ghost pg-folder", "Folder");
  folderBtn.title = "Open the beats folder";
  actions.append(analyzeBtn, dlBtn, folderBtn);

  const close = el("button", "pg-close", "×");
  close.title = "Hide on this video";

  const status = el("div", "pg-status");
  panel.append(stats, actions, close, status);

  analyzeBtn.addEventListener("click", () => run("analyze"));
  dlBtn.addEventListener("click", () => run("download"));
  folderBtn.addEventListener("click", () => send("open-folder", currentId ?? "x"));
  close.addEventListener("click", () => {
    dismissedId = currentId;
    panel.remove();
  });
  return panel;
}

function getPanel() {
  let panel = document.getElementById("beatsense-panel");
  if (!panel) panel = buildPanel();
  // Under the title if possible, otherwise floating
  const anchor = document.querySelector("ytd-watch-metadata #title, #above-the-fold #title");
  if (anchor && panel.previousElementSibling !== anchor) {
    panel.classList.remove("pg-floating");
    anchor.after(panel);
  } else if (!anchor && !panel.isConnected) {
    panel.classList.add("pg-floating");
    document.body.append(panel);
  }
  return panel;
}

function setStatus(text, kind = "") {
  const s = getPanel().querySelector(".pg-status");
  s.textContent = text;
  s.dataset.kind = kind;
}

function setBusy(busy) {
  getPanel().querySelectorAll(".pg-analyze, .pg-download").forEach((b) => (b.disabled = busy));
}

function showResult(d) {
  const p = getPanel();
  p.querySelector(".pg-bpm").textContent = d.bpm;
  p.querySelector(".pg-bpm-alt").textContent = d.bpm_alt ? `or ${d.bpm_alt}` : "";
  p.querySelector(".pg-key").textContent = keyLabel(d.key, d.scale, settings.notation);
  p.querySelector(".pg-camelot").textContent = d.camelot;
  p.querySelector(".pg-stats").title = `Exact BPM: ${d.bpm_exact} — key confidence: ${Math.round(d.confidence * 100)}%`;
}

function reset() {
  const p = getPanel();
  for (const sel of [".pg-bpm", ".pg-key"]) p.querySelector(sel).textContent = "–";
  for (const sel of [".pg-bpm-alt", ".pg-camelot"]) p.querySelector(sel).textContent = "";
  setStatus("");
  setBusy(false);
}

async function run(action) {
  const videoId = currentId;
  if (!videoId) return;
  setBusy(true);
  setStatus(action === "download" ? "Downloading…" : "Analyzing…", "busy");
  // The file name follows the chosen notation ("/" is forbidden in a file name)
  const res = await send(action, videoId, { notation: settings.notation });
  if (videoId !== currentId || !document.getElementById("beatsense-panel")) return; // video changed or panel closed
  setBusy(false);
  if (!res.ok) return setStatus(res.error, "error");
  showResult(res.data);
  setStatus(action === "download" ? `Saved: ${res.data.file.split(/[\\/]/).pop()}` : "", action === "download" ? "ok" : "");
}

function videoTitle() {
  return document.querySelector("ytd-watch-metadata #title h1")?.textContent || document.title;
}

async function refresh() {
  const id = videoIdFromUrl();
  if (!id || !settings.enabled || id === dismissedId) {
    document.getElementById("beatsense-panel")?.remove();
    currentId = null;
    return;
  }
  if (id === currentId) {
    // YouTube sometimes re-renders the title: re-attach the panel if it is shown
    if (document.getElementById("beatsense-panel")) getPanel();
    return;
  }

  currentId = id;
  document.getElementById("beatsense-panel")?.remove();
  // The title and the player take a moment to update after a SPA navigation
  await new Promise((r) => setTimeout(r, 1200));
  if (id !== currentId) return;

  const isProd = PROD_TITLE.test(videoTitle());
  const isMusic = isProd || (await videoCategory(id)) === "Music";
  if (id !== currentId) return;
  if (settings.show === "music" && !isMusic) {
    currentId = null; // to re-evaluate if the settings change
    return;
  }

  reset();
  if ((settings.auto === "prods" && isProd) || (settings.auto === "music" && isMusic)) run("analyze");
}

browser.storage.onChanged.addListener((changes) => {
  if (!changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  currentId = null;
  dismissedId = null;
  refresh();
});

document.addEventListener("yt-navigate-finish", refresh);
loadSettings().then((s) => {
  settings = s;
  refresh();
});
