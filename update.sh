#!/usr/bin/env bash
# YouTube casse régulièrement yt-dlp : à lancer quand les téléchargements échouent.
set -euo pipefail
cd "$(dirname "$0")"
env -u PYTHONHOME -u PYTHONPATH -u VIRTUAL_ENV uv pip install -q -p .venv -U "yt-dlp[default]" deno
systemctl --user restart beatsense.service
.venv/bin/yt-dlp --version
