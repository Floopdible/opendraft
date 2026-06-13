# OpenDraft

Free, open-source browser extension that replays any Google Doc's revision history — no account, no signup, no payment, no external servers.

## How it works

OpenDraft uses the same internal API that Google Docs' own "See revision history" feature uses. It extracts an auth token from the page context, fetches the revision changelog, groups operations into logical steps, and opens a local playback page. All data stays in your browser.

## Installation

### Chrome
1. `chrome://extensions` → Developer mode → Load unpacked → select this directory
2. Open any Google Doc → click **▶ OpenDraft**

### Firefox
```bash
scripts/build-firefox.sh     # creates ../opendraft-firefox/
```
Then `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `opendraft-firefox/manifest.json`

## Features
- Play/pause, seek bar, 0.5×–32× speed
- Diff highlighting (inserts green, deletions red)
- Timeline heatmap of edit density
- Keyboard shortcuts: `Space` play/pause, `←` `→` step

## License
GPL v3 — see [LICENSE](LICENSE).
