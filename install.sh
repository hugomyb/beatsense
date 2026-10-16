#!/usr/bin/env bash
# BeatSense installation on Linux, from a clone of the repository.
# Starts the server at session start (systemd user service), then opens the
# extension in Firefox and/or Chrome. The server then keeps yt-dlp up to date by itself.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
XPI_URL="https://github.com/hugomyb/beatsense/releases/latest/download/beatsense.xpi"
CHROME_ZIP_URL="https://github.com/hugomyb/beatsense/releases/latest/download/beatsense-chrome.zip"

command -v ffmpeg >/dev/null || { echo "ffmpeg missing: sudo apt install ffmpeg"; exit 1; }
command -v uv >/dev/null || { echo "uv missing: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }

# --seed: pip in the venv, used by the server to update itself
env -u PYTHONHOME -u PYTHONPATH -u VIRTUAL_ENV uv venv -q --seed --allow-existing -p 3.12 .venv
env -u PYTHONHOME -u PYTHONPATH -u VIRTUAL_ENV uv pip install -q -p .venv -U -r server/requirements.txt

mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/beatsense.service <<UNIT
[Unit]
Description=BeatSense - YouTube beat downloads for the browser extension

[Service]
ExecStart=$ROOT/.venv/bin/python -I $ROOT/server/beatsense.py
# Always restart: the server stops on purpose after a yt-dlp update
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now beatsense.service
systemctl --user restart beatsense.service
sleep 2
curl -sf http://127.0.0.1:7843/health >/dev/null && echo "BeatSense server started"

[ "${1:-}" = "--no-extension" ] && exit 0

if command -v firefox >/dev/null; then
  # In the download folder: snap Firefox has no access to /tmp
  XPI="$(xdg-user-dir DOWNLOAD 2>/dev/null || echo ~/Downloads)/beatsense.xpi"
  curl -sfL "$XPI_URL" -o "$XPI" && firefox "$XPI" >/dev/null 2>&1 &
  echo "Firefox: click "Add". Updates will then happen automatically."
fi

CHROME=$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)
if [ -n "$CHROME" ]; then
  # The server keeps this folder up to date; Chrome reloads the extension when a version is released
  CHROME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/beatsense/chrome-extension"
  if [ ! -f "$CHROME_DIR/manifest.json" ]; then
    mkdir -p "$CHROME_DIR"
    curl -sfL "$CHROME_ZIP_URL" -o /tmp/beatsense-chrome.zip && unzip -qo /tmp/beatsense-chrome.zip -d "$CHROME_DIR"
  fi
  "$CHROME" chrome://extensions >/dev/null 2>&1 &
  echo "Chrome: enable "Developer mode", then "Load unpacked":"
  echo "  $CHROME_DIR"
fi
