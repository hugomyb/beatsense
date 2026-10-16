# BeatSense

<img src="extension/icons/icon-128.png" width="64" align="right" alt="">

Extension Firefox pour beatmakers : sur une prod YouTube, affiche le BPM, la tonalité (avec la notation Camelot) et télécharge l'instru en mp3 dans ton dossier de prods, avec BPM et tonalité dans le nom du fichier.

- `extension/` : panneau sous le titre des vidéos musicales (catégorie YouTube Musique, ou titre de prod : type beat, instrumental...). L'analyse (essentia.js) se lance toute seule sur les prods. Le bouton BeatSense de la barre d'outils permet de la désactiver, d'afficher le panneau partout ou de régler l'analyse automatique.
- `server/` : petit serveur local (127.0.0.1:7843) qui récupère l'audio avec yt-dlp, ce qu'une extension ne peut pas faire seule.

L'extension est signée par Mozilla mais pas publiée sur le store : elle s'installe depuis les releases de ce dépôt.

## Installation

**Windows** — dans PowerShell :

    irm https://raw.githubusercontent.com/hugomyb/beatsense/main/install.ps1 | iex

**Linux** — ffmpeg et [uv](https://docs.astral.sh/uv/) requis :

    git clone https://github.com/hugomyb/beatsense && cd beatsense && ./install.sh

Les deux scripts lancent le serveur au démarrage de la session et ouvrent l'extension dans Firefox : cliquer sur « Ajouter ».

Les prods arrivent dans `Musique/Prods` (variable d'environnement `BEATSENSE_DIR` pour changer).

## Mises à jour

Tout est automatique :

- l'extension : Firefox vérifie `updates.json` environ une fois par jour ;
- le serveur : il met yt-dlp à jour chaque jour (YouTube le casse régulièrement) et, sous Windows, se remplace par la dernière version de `server/beatsense.py`.

Publier une nouvelle version de l'extension : `./release.sh 1.2.0` (signature Mozilla, release GitHub et `updates.json`).

## Dépannage

- « Serveur BeatSense injoignable » : relancer le PC, ou la commande d'installation.
- Logs sous Linux : `journalctl --user -u beatsense -f`

## Licence

AGPL-3.0, comme [essentia.js](https://github.com/MTG/essentia.js) qui est embarqué dans l'extension.
