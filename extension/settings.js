// Réglages partagés entre le panneau (content.js) et le menu de la barre d'outils (popup).
const DEFAULT_SETTINGS = {
  enabled: true,
  show: "music", // "music" : vidéos musicales et prods seulement, "always" : toutes les vidéos
  auto: "prods", // analyse automatique : "prods", "music" ou "off"
};

async function loadSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}
