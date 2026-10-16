// Chrome offscreen document: fetches and decodes the audio, then has the sandbox page compute.
const frame = document.getElementById("sandbox");
// The sandbox page signals when it is ready (its opaque origin prevents reading its state)
let markReady;
const frameReady = new Promise((resolve) => (markReady = resolve));
frame.addEventListener("load", () => markReady(), { once: true });
const pending = new Map();
let nextId = 0;

window.addEventListener("message", (e) => {
  if (e.source !== frame.contentWindow) return;
  if (e.data.ready) return markReady();
  const { id, result, error } = e.data;
  const p = pending.get(id);
  pending.delete(id);
  if (error) p?.reject(new Error(error));
  else p?.resolve(result);
});

async function analyzeInSandbox(samples) {
  await frameReady;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // The sandbox page has an opaque origin: "*" is the only possible target
    frame.contentWindow.postMessage({ id, samples }, "*", [samples.buffer]);
  });
}

chrome.runtime.onMessage.addListener(({ target, videoId }, _sender, sendResponse) => {
  if (target !== "offscreen") return false;
  fetchAndAnalyze(videoId, analyzeInSandbox).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: errorMessage(e) }),
  );
  return true;
});
