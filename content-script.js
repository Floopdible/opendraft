(function () {
  'use strict';

  const STORAGE_PREFIX = 'opendraft_session_';

  injectStyles();

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      #opendraft-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 12px;
        height: 28px;
        border: 1px solid #dadce0;
        border-radius: 4px;
        background: #fff;
        color: #1a73e8;
        font-family: 'Google Sans', Roboto, Arial, sans-serif;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }
      #opendraft-btn:hover { background: #f1f3f4; box-shadow: 0 1px 2px rgba(60,64,67,0.15); }
      #opendraft-btn:active { background: #e8eaed; }
      #opendraft-btn.loading { background: #fef2f2; color: #ea4335; border-color: #ea4335; pointer-events: none; }
      #opendraft-status {
        font-family: 'Google Sans', Roboto, Arial, sans-serif;
        font-size: 12px;
        color: #5f6368;
        white-space: nowrap;
      }
      #opendraft-error {
        font-family: monospace;
        font-size: 11px;
        color: #ea4335;
        white-space: pre-wrap;
        max-width: 400px;
        word-break: break-all;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 4px;
        padding: 8px;
        max-height: 200px;
        overflow: auto;
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  function getDocId() {
    const m = window.location.pathname.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function getBaseUrl() {
    const m = location.href.match(/^(https:\/\/docs\.google\.com.*?\/document\/d\/)/);
    return m ? m[1] : null;
  }

  function getToken() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'get-token' }, (response) => {
        resolve(response && response.token ? response.token : '');
      });
      setTimeout(() => resolve(''), 8000);
    });
  }

  function findContainer() {
    const selectors = [
      '.docs-titlebar-buttons',
      '.docs-gmeti-buttonstrip',
      '#docs-toolbar',
      '.docs-menubar',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    const toolbar = document.querySelector('#docs-toolbar');
    if (toolbar) return toolbar;
    return null;
  }

  function injectUI() {
    const docId = getDocId();
    if (!docId) return;

    const btn = document.createElement('div');
    btn.id = 'opendraft-btn';
    btn.textContent = '▶ OpenDraft';

    const status = document.createElement('div');
    status.id = 'opendraft-status';
    status.style.display = 'none';

    const error = document.createElement('div');
    error.id = 'opendraft-error';

    const container = findContainer();
    if (container) {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '8px';
      wrapper.appendChild(btn);
      wrapper.appendChild(status);
      wrapper.appendChild(error);
      container.appendChild(wrapper);
    } else {
      const wrapper = document.createElement('div');
      wrapper.style.position = 'fixed';
      wrapper.style.top = '8px';
      wrapper.style.right = '8px';
      wrapper.style.zIndex = '9999';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '8px';
      wrapper.appendChild(btn);
      wrapper.appendChild(status);
      wrapper.appendChild(error);
      document.body.appendChild(wrapper);
    }

    btn.addEventListener('click', () => startLoad(docId, btn, status, error));
  }

  async function startLoad(docId, btn, status, error) {
    btn.classList.add('loading');
    btn.textContent = '⏳ Loading...';
    status.style.display = 'block';
    status.textContent = 'Extracting token...';
    error.style.display = 'none';

    try {
      const token = await getToken();
      if (!token) {
        showError(error, btn, status, 'Could not extract auth token. Try reloading the page.');
        return;
      }

      status.textContent = 'Loading revision metadata...';

      // Step 1: Get revision count and user map from /revisions/tiles
      const baseUrl = getBaseUrl();
      const tilesUrl = `${baseUrl}${docId}/revisions/tiles?id=${docId}&token=${token}&start=1&showDetailedRevisions=false`;

      const tilesResp = await fetch(tilesUrl, { credentials: 'include' });
      if (!tilesResp.ok) {
        showError(error, btn, status, `Revisions tiles API returned ${tilesResp.status}. You may not have edit access to this document.`);
        return;
      }

      let tilesText = await tilesResp.text();
      tilesText = tilesText.replace(/^\)\]\}'\n?/, '');
      const tilesData = JSON.parse(tilesText);

      const tileInfo = tilesData.tileInfo || [];
      const userMap = tilesData.userMap || {};

      if (tileInfo.length === 0) {
        showError(error, btn, status, 'No revision data found for this document.');
        return;
      }

      // Get total revision count from last tile
      const lastTile = tileInfo[tileInfo.length - 1];
      const totalRevisions = lastTile.end || 0;

      if (totalRevisions === 0) {
        showError(error, btn, status, 'Document has no revisions.');
        return;
      }

      status.textContent = `Found ${totalRevisions} revisions. Loading data (this may take a moment)...`;

      // Step 2: Load full changelog
      const loadUrl = `${baseUrl}${docId}/revisions/load?id=${docId}&start=1&end=${totalRevisions}&token=${token}`;

      const loadResp = await fetch(loadUrl, { credentials: 'include' });
      if (!loadResp.ok) {
        showError(error, btn, status, `Revisions load API returned ${loadResp.status}.`);
        return;
      }

      let loadText = await loadResp.text();
      loadText = loadText.replace(/^\)\]\}'\n?/, '');
      const loadData = JSON.parse(loadText);

      const changelog = loadData.changelog || [];

      if (changelog.length === 0) {
        showError(error, btn, status, 'Revision data is empty.');
        return;
      }

      status.textContent = `Loaded ${changelog.length} revisions. Processing...`;

      // Step 3: Group changelog entries into revision batches
      const revisions = groupRevisions(changelog, tileInfo);

      status.textContent = `Storing ${revisions.length} revisions...`;

      // Step 4: Store and open playback
      const sessionKey = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      await chrome.storage.local.set({
        [STORAGE_PREFIX + sessionKey]: { docId, revisions, userMap },
      });

      status.textContent = '✓ Opening playback...';
      chrome.runtime.sendMessage({ action: 'open-playback', sessionKey });

      // Reset button
      setTimeout(() => {
        btn.classList.remove('loading');
        btn.textContent = '▶ OpenDraft';
        status.style.display = 'none';
      }, 2000);

    } catch (e) {
      showError(error, btn, status, `Error: ${e.message}`);
    }
  }

  function groupRevisions(changelog, tileInfo) {
    // Parse entries into {commands, timestamp, authorId}
    const parsed = [];
    for (const entry of changelog) {
      if (!Array.isArray(entry) || entry.length < 1) continue;
      const cmd = entry[0];
      if (!cmd || typeof cmd !== 'object') continue;
      const ts = typeof entry[1] === 'number' ? entry[1] : 0;
      const authorId = typeof entry[2] === 'string' ? entry[2] : null;
      parsed.push({ commands: [cmd], timestamp: ts, authorId });
    }

    if (parsed.length === 0) return [];

    // Group consecutive entries with same timestamp (they're part of same operation burst)
    const groups = [];
    let current = null;

    for (const entry of parsed) {
      if (!current) {
        current = { commands: [...entry.commands], timestamp: entry.timestamp, authorId: entry.authorId };
        continue;
      }
      if (entry.timestamp === current.timestamp && entry.timestamp > 0) {
        current.commands.push(...entry.commands);
      } else {
        groups.push(current);
        current = { commands: [...entry.commands], timestamp: entry.timestamp, authorId: entry.authorId };
      }
    }
    if (current) groups.push(current);

    // Attach human-readable timestamps from tile data
    if (tileInfo && tileInfo.length > 0 && tileInfo[0].startMillis) {
      // Build interpolation: assign one timestamp per group based on cumulative distribution
      const totalGroups = groups.length;
      const tileRevisions = tileInfo[tileInfo.length - 1].end || totalGroups;
      for (let i = 0; i < totalGroups; i++) {
        const fraction = i / totalGroups;
        // Find which tile this fraction falls in
        for (const tile of tileInfo) {
          const tileStartRev = tile.start || 1;
          const tileEndRev = tile.end || tileRevisions;
          const tileStartNorm = (tileStartRev - 1) / tileRevisions;
          const tileEndNorm = tileEndRev / tileRevisions;
          if (fraction >= tileStartNorm && fraction <= tileEndNorm) {
            const t = (fraction - tileStartNorm) / (tileEndNorm - tileStartNorm || 1);
            const ms = (tile.startMillis || 0) + t * ((tile.endMillis || 0) - (tile.startMillis || 0));
            groups[i].timestamp_usec = Math.round(ms);
            break;
          }
        }
      }
    }

    return groups;
  }

  function showError(error, btn, status, msg) {
    error.textContent = msg;
    error.style.display = 'block';
    btn.classList.remove('loading');
    btn.textContent = '▶ OpenDraft';
    status.textContent = 'Failed';
    setTimeout(() => {
      status.style.display = 'none';
    }, 5000);
  }

  function waitAndInject() {
    const check = () => {
      const container = findContainer();
      if (container || document.querySelector('#docs-chrome')) {
        injectUI();
        return;
      }
      if (document.body && document.body.children.length > 0) {
        injectUI();
        return;
      }
      setTimeout(check, 500);
    };
    check();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(waitAndInject, 500);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(waitAndInject, 500));
  }
})();
