#!/usr/bin/env bash
# Installe le serveur BeatSense et le lance au démarrage de la session (service systemd utilisateur).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"

command -v ffmpeg >/dev/null || { echo "ffmpeg manquant : sudo apt install ffmpeg"; exit 1; }
command -v uv >/dev/null || { echo "uv manquant : https://docs.astral.sh/uv/"; exit 1; }

env -u PYTHONHOME -u PYTHONPATH -u VIRTUAL_ENV uv venv -q --allow-existing -p 3.12 .venv
env -u PYTHONHOME -u PYTHONPATH -u VIRTUAL_ENV uv pip install -q -p .venv -U -r server/requirements.txt

mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/beatsense.service <<UNIT
[Unit]
Description=BeatSense - BPM, tonalité et téléchargement des prods YouTube

[Service]
# Le bin du venv en tête du PATH : yt-dlp y trouve deno pour les signatures YouTube
Environment=PATH=$ROOT/.venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$ROOT/.venv/bin/python -I $ROOT/server/beatsense.py
Restart=on-failure

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now beatsense.service
systemctl --user restart beatsense.service
echo "Serveur lancé : http://127.0.0.1:7843/health"
