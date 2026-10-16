// Settings shared between the panel (content.js) and the toolbar popup.
globalThis.browser ??= chrome;
const DEFAULT_SETTINGS = {
  enabled: true,
  show: "music", // "music": music videos and beats only, "always": all videos
  auto: "prods", // auto-analysis: "prods", "music" or "off"
  notation: "both", // keys: "flats" (Ab), "sharps" (G#, as in FL Studio) or "both" (Ab / G#)
};

// The same piano key can be written as a flat or a sharp (enharmonic equivalents)
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
