#!/usr/bin/env bash
# Publie une nouvelle version de l'extension, installée ensuite automatiquement par
# Firefox sur tous les PC (il vérifie updates.json environ une fois par jour).
#   ./release.sh 1.2.0
#
# Signature Mozilla (canal "unlisted" : hors du store). Clés API dans ~/.config/beatsense/amo.env :
#   WEB_EXT_API_KEY=user:12345:67
#   WEB_EXT_API_SECRET=...
# (https://addons.mozilla.org/developers/addon/api/key/)
set -euo pipefail
cd "$(dirname "$0")"

VERSION=${1:?"usage : ./release.sh <version>, par ex. ./release.sh 1.2.0"}
REPO=hugomyb/beatsense
ENV_FILE=~/.config/beatsense/amo.env
[ -f "$ENV_FILE" ] || { echo "Clés manquantes : crée $ENV_FILE (voir l'en-tête de ce script)"; exit 1; }
git diff --quiet HEAD || { echo "Des modifications ne sont pas commitées : commit d'abord."; exit 1; }
set -a; source "$ENV_FILE"; set +a

sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" extension/manifest.json

rm -rf dist
npx -y web-ext@8 sign --channel unlisted --source-dir extension --artifacts-dir dist
mv dist/*.xpi dist/beatsense.xpi

cat > updates.json <<JSON
{
  "addons": {
    "beatsense@hugo.local": {
      "updates": [
        {
          "version": "$VERSION",
          "update_link": "https://github.com/$REPO/releases/download/v$VERSION/beatsense.xpi"
        }
      ]
    }
  }
}
JSON

git add updates.json extension/manifest.json
git commit -q -m "Extension $VERSION"
git tag "v$VERSION"
# La release avant la branche : updates.json ne doit jamais pointer vers un fichier absent
git push -q origin "v$VERSION"
gh release create "v$VERSION" dist/beatsense.xpi -R "$REPO" -t "BeatSense $VERSION" \
  -n "Installée automatiquement par Firefox sur les PC qui ont déjà BeatSense."
git push -q
echo "Version $VERSION publiée"
