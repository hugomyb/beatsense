// Service worker Chrome. Il n'a ni décodage audio ni droit à essentia.js : l'analyse passe par
// un document offscreen (décodage) qui la confie à une page sandbox (essentia.js).
importScripts("/settings.js", "/core.js");

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: "chrome/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Décodage et analyse audio (BPM, tonalité)",
    });
  } catch (e) {
    // deux analyses lancées en même temps : le document vient d'être créé par l'autre
    if (!(await chrome.offscreen.hasDocument())) throw e;
  }
}

listen(
  createActions(async (videoId) => {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: "offscreen", videoId });
    if (!res?.ok) throw new ServerError(res?.error ?? "Analyse impossible");
    return res.data;
  }),
);

// Mises à jour : Chrome ne met pas à jour une extension non publiée. Le serveur local remplace
// les fichiers de l'extension par ceux de la dernière release ; il suffit ensuite de la recharger.
const newer = (a, b) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
};

async function checkUpdate() {
  try {
    const { chrome_version } = await (await fetch(`${SERVER}/health`)).json();
    if (chrome_version && newer(chrome_version, chrome.runtime.getManifest().version)) chrome.runtime.reload();
  } catch {
    // serveur arrêté : on réessaiera à la prochaine alarme
  }
}

chrome.alarms.create("update", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((a) => a.name === "update" && checkUpdate());
chrome.runtime.onStartup.addListener(checkUpdate);
