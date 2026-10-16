// Réglages partagés entre le panneau (content.js) et le menu de la barre d'outils (popup).
globalThis.browser ??= chrome;
const DEFAULT_SETTINGS = {
  enabled: true,
  show: "music", // "music" : vidéos musicales et prods seulement, "always" : toutes les vidéos
  auto: "prods", // analyse automatique : "prods", "music" ou "off"
  notation: "both", // tonalités : "flats" (Ab), "sharps" (G#, comme FL Studio) ou "both" (Ab / G#)
};

// La même touche du piano s'écrit en bémol ou en dièse (équivalents enharmoniques)
const AS_SHARP = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
const AS_FLAT = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };

function keyLabel(key, scale, notation, separator = " / ") {
  const sharp = AS_SHARP[key] ?? key;
  const flat = AS_FLAT[key] ?? key;
  const note = notation === "sharps" ? sharp : notation === "flats" || flat === sharp ? flat : `${flat}${separator}${sharp}`;
  return `${note} ${scale === "major" ? "Major" : "Minor"}`;
}

async function loadSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}
