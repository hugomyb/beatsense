# BeatSense

<img src="extension/icons/icon-128.png" width="64" align="right" alt="">

Extension Firefox et Chrome pour beatmakers : sur une prod YouTube, affiche le BPM, la tonalité (avec la notation Camelot) et télécharge l'instru en mp3 dans ton dossier de prods, avec BPM et tonalité dans le nom du fichier.

- `extension/` : panneau sous le titre des vidéos musicales (catégorie YouTube Musique, ou titre de prod : type beat, instrumental...). L'analyse (essentia.js) se lance toute seule sur les prods. Le bouton BeatSense de la barre d'outils permet de la désactiver, d'afficher le panneau partout ou de régler l'analyse automatique.
- `extension/chrome/` : spécifique à Chrome (Manifest V3) : essentia.js tourne dans une page sandbox, via un document offscreen. `./build.sh` assemble `build/firefox` et `build/chrome`.
- `server/` : petit serveur local (127.0.0.1:7843) qui récupère l'audio avec yt-dlp, ce qu'une extension ne peut pas faire seule.

L'extension n'est publiée sur aucun store : elle s'installe depuis les releases de ce dépôt (signée par Mozilla pour Firefox, chargée « non empaquetée » dans Chrome).

## Installation

**Windows** — dans PowerShell :

    irm https://raw.githubusercontent.com/hugomyb/beatsense/main/install.ps1 | iex

**Linux** — ffmpeg et [uv](https://docs.astral.sh/uv/) requis :

    git clone https://github.com/hugomyb/beatsense && cd beatsense && ./install.sh

Les deux scripts lancent le serveur au démarrage de la session, puis :

- Firefox : cliquer sur « Ajouter » ;
- Chrome : sur la page des extensions qui s'ouvre, activer le « Mode développeur », puis « Charger l'extension non empaquetée » et choisir le dossier indiqué par le script (`%LOCALAPPDATA%\BeatSense\chrome-extension` sous Windows, `~/.local/share/beatsense/chrome-extension` sous Linux).

Les prods arrivent dans `Musique/Prods` (variable d'environnement `BEATSENSE_DIR` pour changer).

## Mises à jour

Tout est automatique :

- l'extension Firefox : Firefox vérifie `updates.json` une fois par 24 h (ou `about:addons` > « Rechercher des mises à jour ») ;
- l'extension Chrome : le serveur remplace les fichiers du dossier par ceux de la dernière release, et l'extension se recharge (vérification toutes les heures) ;
- le serveur : il met yt-dlp à jour chaque jour (YouTube le casse régulièrement) et, sous Windows, se remplace par la dernière version de `server/beatsense.py`.

Publier une nouvelle version : `./release.sh 1.4.0` (build des deux versions, signature Mozilla, release GitHub et `updates.json`).

## Précision de l'analyse

Réglages choisis sur 58 type beats dont la description annonce BPM et tonalité : tonalité exacte dans 76 % des cas (profil `edmm` sur le morceau entier), tempo exact à ±1 BPM dans 84 % des cas et 97 % en comptant le double / la moitié (affichés en petit à côté).

## Dépannage

- « Serveur BeatSense injoignable » : relancer le PC, ou la commande d'installation.
- Logs sous Linux : `journalctl --user -u beatsense -f`

## Licence

AGPL-3.0, comme [essentia.js](https://github.com/MTG/essentia.js) qui est embarqué dans l'extension.
