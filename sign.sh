#!/usr/bin/env bash
# Fait signer l'extension par Mozilla (canal "unlisted" : privée, pas publiée sur le store)
# et produit un .xpi installable de façon permanente dans n'importe quel Firefox.
#
# Clés API : https://addons.mozilla.org/developers/addon/api/key/
# à mettre dans ~/.config/beatsense/amo.env :
#   WEB_EXT_API_KEY=user:12345:67
#   WEB_EXT_API_SECRET=...
#
# Mozilla refuse de signer deux fois la même version : passer la nouvelle en argument.
#   ./sign.sh 1.0.1
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=~/.config/beatsense/amo.env
[ -f "$ENV_FILE" ] || { echo "Clés manquantes : crée $ENV_FILE (voir l'en-tête de ce script)"; exit 1; }
set -a; source "$ENV_FILE"; set +a

if [ $# -ge 1 ]; then
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$1\"/" extension/manifest.json
fi

npx -y web-ext@8 sign --channel unlisted --source-dir extension --artifacts-dir dist
ls -1t dist/*.xpi | head -1
