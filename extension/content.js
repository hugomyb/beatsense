// Panneau BeatSense injecté sous la vidéo. YouTube est une SPA : on se recale à chaque navigation.
const PROD_TITLE = /type\s*beat|instru(mental)?|\bprod\b|\bbeat\b|\bfree\b.*\b(beat|prod)\b/i;

let settings = DEFAULT_SETTINGS;
let currentId = null;
let dismissedId = null; // vidéo sur laquelle le panneau a été fermé avec la croix
const categories = new Map();

const videoIdFromUrl = () => {
  const url = new URL(location.href);
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const m = url.pathname.match(/^\/shorts\/([\w-]{11})/);
  return m ? m[1] : null;
};

const send = (action, videoId) => browser.runtime.sendMessage({ action, videoId });

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Catégorie YouTube de la vidéo ("Music", "Gaming"...), toujours en anglais quelle que soit la langue.
function videoCategory(id) {
  if (location.hostname === "music.youtube.com") return Promise.resolve("Music");
  // Le lecteur la connaît déjà, sauf s'il n'a pas encore chargé la nouvelle vidéo
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
  const analyzeBtn = el("button", "pg-btn pg-analyze", "Analyser");
  const dlBtn = el("button", "pg-btn pg-primary pg-download", "Télécharger");
  const folderBtn = el("button", "pg-btn pg-ghost pg-folder", "Dossier");
  folderBtn.title = "Ouvrir le dossier des prods";
  actions.append(analyzeBtn, dlBtn, folderBtn);

  const close = el("button", "pg-close", "×");
  close.title = "Masquer sur cette vidéo";

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
  // Sous le titre si possible, sinon en flottant
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
  p.querySelector(".pg-bpm-alt").textContent = d.bpm_alt ? `ou ${d.bpm_alt}` : "";
  p.querySelector(".pg-key").textContent = d.key_label;
  p.querySelector(".pg-camelot").textContent = d.camelot;
  p.querySelector(".pg-stats").title = `BPM exact : ${d.bpm_exact} — confiance tonalité : ${Math.round(d.confidence * 100)} %`;
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
  setStatus(action === "download" ? "Téléchargement…" : "Analyse en cours…", "busy");
  const res = await send(action, videoId);
  if (videoId !== currentId || !document.getElementById("beatsense-panel")) return; // vidéo changée ou panneau fermé
  setBusy(false);
  if (!res.ok) return setStatus(res.error, "error");
  showResult(res.data);
  setStatus(action === "download" ? `Enregistré : ${res.data.file.split(/[\\/]/).pop()}` : "", action === "download" ? "ok" : "");
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
    // YouTube re-rend parfois le titre : on raccroche le panneau s'il est affiché
    if (document.getElementById("beatsense-panel")) getPanel();
    return;
  }

  currentId = id;
  document.getElementById("beatsense-panel")?.remove();
  // Le titre et le lecteur mettent un instant à se mettre à jour après une navigation SPA
  await new Promise((r) => setTimeout(r, 1200));
  if (id !== currentId) return;

  const isProd = PROD_TITLE.test(videoTitle());
  const isMusic = isProd || (await videoCategory(id)) === "Music";
  if (id !== currentId) return;
  if (settings.show === "music" && !isMusic) {
    currentId = null; // pour réévaluer si les réglages changent
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
