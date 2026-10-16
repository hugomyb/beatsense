// Panneau BeatSense injecté sous la vidéo. YouTube est une SPA : on se recale à chaque navigation.
const PROD_TITLE = /type\s*beat|instru(mental)?|\bprod\b|\bbeat\b|\bfree\b.*\b(beat|prod)\b/i;

let currentId = null;

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

  const status = el("div", "pg-status");
  panel.append(stats, actions, status);

  analyzeBtn.addEventListener("click", () => run("analyze"));
  dlBtn.addEventListener("click", () => run("download"));
  folderBtn.addEventListener("click", () => send("open-folder", currentId ?? "x"));
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
  if (videoId !== currentId) return; // l'utilisateur a changé de vidéo entre-temps
  setBusy(false);
  if (!res.ok) return setStatus(res.error, "error");
  showResult(res.data);
  setStatus(action === "download" ? `Enregistré : ${res.data.file.split("/").pop()}` : "", action === "download" ? "ok" : "");
}

function videoTitle() {
  return document.querySelector("ytd-watch-metadata #title h1")?.textContent || document.title;
}

function onNavigate() {
  const id = videoIdFromUrl();
  const panel = document.getElementById("beatsense-panel");
  if (!id) {
    panel?.remove();
    currentId = null;
    return;
  }
  if (id === currentId) return getPanel();
  currentId = id;
  reset();
  // Le titre met un instant à se mettre à jour après une navigation SPA
  setTimeout(() => {
    getPanel();
    if (id === currentId && PROD_TITLE.test(videoTitle())) run("analyze");
  }, 1200);
}

document.addEventListener("yt-navigate-finish", onNavigate);
onNavigate();
