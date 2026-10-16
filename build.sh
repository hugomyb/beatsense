#!/usr/bin/env bash
# Build both versions of the extension from extension/:
#   build/firefox: Manifest V2, essentia.js in the background page
#   build/chrome:  Manifest V3, essentia.js in a sandbox page via an offscreen document
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
echo "build/firefox and build/chrome ready"
