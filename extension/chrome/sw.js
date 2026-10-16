// Chrome service worker. It has neither audio decoding nor access to essentia.js: the analysis goes
// through an offscreen document (decoding) that hands it to a sandbox page (essentia.js).
importScripts("/settings.js", "/core.js");

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: "chrome/offscreen.html",
      reasons: ["WORKERS"],
      justification: "Audio decoding and analysis (BPM, key)",
    });
  } catch (e) {
    // two analyses started at the same time: the other one just created the document
    if (!(await chrome.offscreen.hasDocument())) throw e;
  }
}

listen(
  createActions(async (videoId) => {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: "offscreen", videoId });
    if (!res?.ok) throw new ServerError(res?.error ?? "Analysis failed");
    return res.data;
  }),
);

// Updates: Chrome does not update an unpublished extension. The local server replaces the
// extension files with those of the latest release; the extension then just has to reload.
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
    // server stopped: we will retry on the next alarm
  }
}

chrome.alarms.create("update", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((a) => a.name === "update" && checkUpdate());
chrome.runtime.onStartup.addListener(checkUpdate);
