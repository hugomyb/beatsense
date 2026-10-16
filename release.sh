#!/usr/bin/env bash
# Publishes a new version of the extension, then installed automatically by
# Firefox on every PC (it checks updates.json about once a day).
#   ./release.sh 1.2.0
#
# The Chrome extension (dist/beatsense-chrome.zip) is updated by each PC's local server.
#
# Mozilla signing ("unlisted" channel: outside the store). API keys in ~/.config/beatsense/amo.env :
#   WEB_EXT_API_KEY=user:12345:67
#   WEB_EXT_API_SECRET=...
# (https://addons.mozilla.org/developers/addon/api/key/)
set -euo pipefail
cd "$(dirname "$0")"

VERSION=${1:?"usage: ./release.sh <version>, e.g. ./release.sh 1.2.0"}
REPO=hugomyb/beatsense
ENV_FILE=~/.config/beatsense/amo.env
[ -f "$ENV_FILE" ] || { echo "Missing keys: create $ENV_FILE (see the header of this script)"; exit 1; }
git diff --quiet HEAD || { echo "There are uncommitted changes: commit first."; exit 1; }
set -a; source "$ENV_FILE"; set +a

sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" extension/manifest.*.json
./build.sh

rm -rf dist
npx -y web-ext@8 sign --channel unlisted --source-dir build/firefox --artifacts-dir dist
mv dist/*.xpi dist/beatsense.xpi
# Chrome: no signing possible outside the store, the local server installs this zip
(cd build/chrome && zip -qr ../../dist/beatsense-chrome.zip .)

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

git add updates.json extension/manifest.*.json
git commit -q -m "Extension $VERSION"
git tag "v$VERSION"
# Release before the branch: updates.json must never point to a missing file
git push -q origin "v$VERSION"
gh release create "v$VERSION" dist/beatsense.xpi dist/beatsense-chrome.zip -R "$REPO" -t "BeatSense $VERSION" \
  -n "Installed automatically by Firefox on PCs that already have BeatSense."
git push -q
echo "Version $VERSION published"
