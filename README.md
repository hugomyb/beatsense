# BeatSense

Extension Firefox : BPM, tonalité (+ Camelot) et téléchargement mp3 d'une prod directement depuis YouTube.

- `server/` : serveur local (127.0.0.1:7843) — yt-dlp pour l'audio, essentia pour BPM/tonalité. Service systemd utilisateur `beatsense`.
- `extension/` : panneau injecté sous le titre de la vidéo. Analyse automatique si le titre ressemble à une prod (type beat, instrumental, prod...), sinon bouton « Analyser ».

## Installation

    ./install.sh

Extension, installation permanente :

1. `./sign.sh` (première fois) ou `./sign.sh 1.0.1` (après une modif de l'extension) : le .xpi signé arrive dans `dist/`.
2. Firefox : `about:addons` > roue dentée > « Installer un module depuis un fichier » > le .xpi.

Sur un autre PC : cloner le dépôt, `./install.sh`, puis installer le même .xpi.

Pour tester sans signer : `about:debugging#/runtime/this-firefox` > « Charger un module temporaire » > `extension/manifest.json`.

## Réglages (variables d'environnement du service)

- `BEATSENSE_DIR` : dossier des prods (défaut `~/Musique/Prods`)
- `BEATSENSE_PORT` : port (défaut 7843, à changer aussi dans `background.js` et `manifest.json`)

## Quand YouTube casse les téléchargements

    ./update.sh

Logs : `journalctl --user -u beatsense -f`
