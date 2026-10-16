#!/usr/bin/env bash
# Installation de BeatSense sous Linux, depuis un clone du dépôt.
# Lance le serveur au démarrage de la session (service systemd utilisateur), puis ouvre
# l'extension dans Firefox. Le serveur met ensuite yt-dlp à jour tout seul.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
XPI_URL="https://github.com/hugomyb/beatsense/releases/latest/download/beatsense.xpi"

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

if [ "${1:-}" != "--no-extension" ] && command -v firefox >/dev/null; then
  # Dans le dossier de téléchargement : Firefox en snap n'a pas accès à /tmp
  XPI="$(xdg-user-dir DOWNLOAD 2>/dev/null || echo ~/Downloads)/beatsense.xpi"
  curl -sfL "$XPI_URL" -o "$XPI" && firefox "$XPI" >/dev/null 2>&1 &
  echo "Clique sur « Ajouter » dans Firefox. Les mises à jour se feront ensuite toutes seules."
fi
