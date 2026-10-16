#!/usr/bin/env bash
# Installation de BeatSense sous Linux, depuis un clone du dépôt.
# Lance le serveur au démarrage de la session (service systemd utilisateur), puis ouvre
# l'extension dans Firefox et/ou Chrome. Le serveur met ensuite yt-dlp à jour tout seul.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
XPI_URL="https://github.com/hugomyb/beatsense/releases/latest/download/beatsense.xpi"
CHROME_ZIP_URL="https://github.com/hugomyb/beatsense/releases/latest/download/beatsense-chrome.zip"

command -v ffmpeg >/dev/null || { echo "ffmpeg manquant : sudo apt install ffmpeg"; exit 1; }
command -v uv >/dev/null || { echo "uv manquant : curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }

# --seed : pip dans le venv, utilisé par le serveur pour se mettre à jour
env -u PYTHONHOME -u PYTHONPATH -u VIRTUAL_ENV uv venv -q --seed --allow-existing -p 3.12 .venv
env -u PYTHONHOME -u PYTHONPATH -u VIRTUAL_ENV uv pip install -q -p .venv -U -r server/requirements.txt

mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/beatsense.service <<UNIT
[Unit]
Description=BeatSense - téléchargement des prods YouTube pour l'extension Firefox

[Service]
ExecStart=$ROOT/.venv/bin/python -I $ROOT/server/beatsense.py
# Toujours relancer : le serveur s'arrête volontairement après une mise à jour de yt-dlp
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now beatsense.service
systemctl --user restart beatsense.service
sleep 2
curl -sf http://127.0.0.1:7843/health >/dev/null && echo "Serveur BeatSense lancé"

[ "${1:-}" = "--no-extension" ] && exit 0

if command -v firefox >/dev/null; then
  # Dans le dossier de téléchargement : Firefox en snap n'a pas accès à /tmp
  XPI="$(xdg-user-dir DOWNLOAD 2>/dev/null || echo ~/Downloads)/beatsense.xpi"
  curl -sfL "$XPI_URL" -o "$XPI" && firefox "$XPI" >/dev/null 2>&1 &
  echo "Firefox : clique sur « Ajouter ». Les mises à jour se feront ensuite toutes seules."
fi

CHROME=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)
if [ -n "$CHROME" ]; then
  # Le serveur tient ce dossier à jour ; Chrome recharge l'extension quand une version sort
  CHROME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/beatsense/chrome-extension"
  if [ ! -f "$CHROME_DIR/manifest.json" ]; then
    mkdir -p "$CHROME_DIR"
    curl -sfL "$CHROME_ZIP_URL" -o /tmp/beatsense-chrome.zip && unzip -qo /tmp/beatsense-chrome.zip -d "$CHROME_DIR"
  fi
  "$CHROME" chrome://extensions >/dev/null 2>&1 &
  echo "Chrome : active le « Mode développeur », puis « Charger l'extension non empaquetée » :"
  echo "  $CHROME_DIR"
fi
