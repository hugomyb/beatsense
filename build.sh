#!/usr/bin/env bash
# Assemble les deux versions de l'extension à partir de extension/ :
#   build/firefox : Manifest V2, essentia.js dans la page de fond
#   build/chrome  : Manifest V3, essentia.js dans une page sandbox via un document offscreen
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build
for target in firefox chrome; do
  mkdir -p "build/$target"
  cp -r extension/{core.js,essentia-runner.js,settings.js,content.js,content.css,icons,lib,popup} "build/$target/"
  cp "extension/manifest.$target.json" "build/$target/manifest.json"
done
cp extension/background.js build/firefox/
cp -r extension/chrome build/chrome/
echo "build/firefox et build/chrome prêts"
