// Le content script ne peut pas joindre localhost directement (CORS de la page YouTube) :
// il passe par ici, qui a la permission sur le serveur local.
const SERVER = "http://127.0.0.1:7843";

browser.runtime.onMessage.addListener(async ({ action, videoId }) => {
  try {
    const res = await fetch(`${SERVER}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_id: videoId }),
    });
    const data = await res.json();
    return res.ok ? { ok: true, data } : { ok: false, error: data.error || `Erreur ${res.status}` };
  } catch {
    return { ok: false, error: "Serveur BeatSense injoignable (systemctl --user start beatsense)" };
  }
});
