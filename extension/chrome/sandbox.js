// Page sandbox Chrome : seule page où Manifest V3 autorise essentia.js. Pas d'API d'extension,
// elle ne communique qu'avec le document offscreen qui l'héberge.
window.addEventListener("message", (e) => {
  const { id, samples } = e.data;
  try {
    e.source.postMessage({ id, result: analyzeSamples(samples) }, "*");
  } catch (err) {
    e.source.postMessage({ id, error: String(err?.message ?? err) }, "*");
  }
});

window.parent.postMessage({ ready: true }, "*");
