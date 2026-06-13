#!/bin/sh
set -e
SRC="$(dirname "$0")/.."
DST="$(dirname "$0")/../../opendraft-firefox"

echo "Building Firefox add-on from $SRC ..."

rm -rf "$DST"
cp -r "$SRC" "$DST"
rm -f "$DST/manifest.json"
rm -rf "$DST/scripts"

cat > "$DST/manifest.json" << 'MANIFEST'
{
  "manifest_version": 2,
  "name": "OpenDraft",
  "version": "1.0.0",
  "description": "Free, open-source Google Docs revision history player. Replay any document's writing process.",
  "permissions": [
    "storage",
    "unlimitedStorage",
    "*://docs.google.com/*"
  ],
  "background": {
    "scripts": ["background.js"],
    "persistent": false
  },
  "content_scripts": [
    {
      "matches": ["*://docs.google.com/document/*"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
MANIFEST

echo "Done: $DST"
