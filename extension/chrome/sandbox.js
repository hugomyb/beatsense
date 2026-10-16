// Chrome sandbox page: the only page where Manifest V3 allows essentia.js. No extension API,
// it only talks to the offscreen document that hosts it.
window.addEventListener("message", (e) => {
  const { id, samples } = e.data;
  try {
    e.source.postMessage({ id, result: analyzeSamples(samples) }, "*");
  } catch (err) {
    e.source.postMessage({ id, error: String(err?.message ?? err) }, "*");
  }
});

window.parent.postMessage({ ready: true }, "*");
