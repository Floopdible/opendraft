(async function () {
  const params = new URLSearchParams(window.location.search);
  const sessionKey = params.get('session');
  if (!sessionKey) {
    document.getElementById('status').textContent =
      'No session data found. Open a Google Doc and click the OpenDraft button first.';
    return;
  }

  const STORAGE_PREFIX = 'opendraft_session_';
  const stored = await chrome.storage.local.get(STORAGE_PREFIX + sessionKey);
  const data = stored[STORAGE_PREFIX + sessionKey];
  if (!data || !data.revisions || data.revisions.length === 0) {
    document.getElementById('status').textContent =
      'No revision data found. The session may have expired.';
    return;
  }

  document.getElementById('status').style.display = 'none';
  document.getElementById('main-ui').style.display = 'flex';

  const { docId, revisions } = data;
  let snapshots = [];
  let currentIndex = 0;
  let isPlaying = false;
  let playbackTimer = null;
  let playbackSpeed = 4;
  let playbackMode = 'step';
  let idleThreshold = Infinity;

  const contentArea = document.getElementById('content');
  const timeline = document.getElementById('timeline');
  const timelineMarker = document.getElementById('timeline-marker');
  const playBtn = document.getElementById('play-btn');
  const playIcon = document.getElementById('play-icon');
  const seekBar = document.getElementById('seek-bar');
  const speedDisplay = document.getElementById('speed-display');
  const revCount = document.getElementById('rev-count');
  const revCurrent = document.getElementById('rev-current');
  const statsText = document.getElementById('stats-text');

  contentArea.innerHTML = '<div class="loading-msg">Building revision history...</div>';

  revCount.textContent = revisions.length;

  function build() {
    try {
      snapshots = buildRevisionSnapshots(revisions);
    } catch (e) {
      contentArea.innerHTML = `<div class="error-msg">Error building revision data: ${e.message}`;
      return;
    }

    if (snapshots.length === 0) {
      contentArea.innerHTML = '<div class="error-msg">No revisions could be processed.';
      return;
    }

    // Compute dynamic idle threshold
    if (snapshots.length >= 2) {
      const gaps = [];
      for (let i = 0; i < snapshots.length - 1; i++) {
        gaps.push(Math.max(1, (snapshots[i + 1].time || 0) - (snapshots[i].time || 0)));
      }
      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      idleThreshold = Math.max(5 * 60 * 1000, median * 5);
    }

    seekBar.max = snapshots.length - 1;
    seekBar.value = 0;
    revCurrent.textContent = '0';
    updateStats();
    renderCurrent();
    updateTimeline();
    updateRevTime();
  }

  function setPlayIcon(play) {
    playIcon.innerHTML = play
      ? '<path d="M7 4h2v12H7zM13 4h2v12h-2z" fill="currentColor"/>'
      : '<path d="M5 4l12 6-12 6z" fill="currentColor"/>';
    playBtn.title = play ? 'Pause' : 'Play';
  }

  function renderCurrent() {
    if (!snapshots.length) return;
    const prev = currentIndex > 0 ? snapshots[currentIndex - 1] : null;
    const snapshot = snapshots[currentIndex];

    contentArea.innerHTML = '';
    const rendered = renderSnapshot(snapshot, prev);
    contentArea.appendChild(rendered);

    seekBar.value = currentIndex;
    revCurrent.textContent = currentIndex;
    updateMarker();
    updateStats();
    updateRevTime();
  }

  function updateMarker() {
    if (!snapshots.length) return;
    const snapTimes = [0];
    for (let i = 0; i < snapshots.length - 1; i++) {
      const gap = Math.max(1, (snapshots[i + 1].time || 0) - (snapshots[i].time || 0));
      snapTimes.push(snapTimes[i] + gap);
    }
    const total = snapTimes[snapTimes.length - 1];
    const pct = total > 0 ? snapTimes[currentIndex] / total : currentIndex / (snapshots.length - 1);
    const tw = timeline.clientWidth;
    const left = Math.round(pct * tw);
    timelineMarker.style.left = `${left}px`;
  }

  function snapIdxAtFraction(frac) {
    frac = Math.max(0, Math.min(1, frac));
    if (frac >= 1) return snapshots.length - 1;
    if (frac <= 0) return 0;

    const snapTimes = [0];
    for (let i = 0; i < snapshots.length - 1; i++) {
      const gap = Math.max(1, (snapshots[i + 1].time || 0) - (snapshots[i].time || 0));
      snapTimes.push(snapTimes[i] + gap);
    }
    const target = snapTimes[snapTimes.length - 1] * frac;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < snapTimes.length; i++) {
      const dist = Math.abs(snapTimes[i] - target);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    return bestIdx;
  }

  function formatTimeLabel(ms) {
    if (!ms || ms < 1000000000000) return '';
    return new Date(ms).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function updateTimeline() {
    const oldCanvas = timeline.querySelector('canvas');
    if (oldCanvas) oldCanvas.remove();

    const canvas = document.createElement('canvas');
    canvas.width = timeline.clientWidth || 600;
    canvas.height = 24;
    timeline.appendChild(canvas);

    if (snapshots.length < 2) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Compute time gaps between consecutive snapshots
    const gaps = [];
    let totalTime = 0;
    for (let i = 0; i < snapshots.length - 1; i++) {
      const gap = Math.max(1, (snapshots[i + 1].time || 0) - (snapshots[i].time || 0));
      gaps.push(gap);
      totalTime += gap;
    }

    // Compute average churn for active (non-idle) periods
    let totalActiveChurn = 0;
    let activeCount = 0;
    let prevText = '';
    for (let i = 0; i < snapshots.length - 1; i++) {
      const gap = gaps[i];
      const text = snapshots[i + 1].text;
      const diff = text.length - prevText.length;
      const churn = Math.abs(diff) + (diff === 0 && text !== prevText ? 1 : 0);
      if (gap < idleThreshold) {
        totalActiveChurn += churn;
        activeCount++;
      }
      prevText = text;
    }
    const avgActiveChurn = activeCount > 0 ? totalActiveChurn / activeCount : 1;

    // Draw background
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, 0, w, h);

    // Draw each segment proportionally by time
    let x = 0;
    prevText = snapshots[0].text;
    const gray = '#d1d5db';
    const idleMin = Math.round(idleThreshold / 60000);
    for (let i = 0; i < snapshots.length - 1; i++) {
      const gap = gaps[i];
      const segW = Math.max(1, Math.round(w * (gap / totalTime)));

      const text = snapshots[i + 1].text;
      const diff = text.length - prevText.length;
      const churn = Math.abs(diff) + (diff === 0 && text !== prevText ? 1 : 0);

      prevText = text;

      if (gap >= idleThreshold) {
        ctx.fillStyle = gray;
        ctx.fillRect(x, 0, segW, h);
        x += segW;
        continue;
      }

      const ratio = churn / (avgActiveChurn || 1);
      const intensity = Math.min(1, Math.log(1 + ratio) / Math.log(101));

      let r, g, b;
      if (intensity < 0.5) {
        const t = intensity / 0.5;
        r = Math.round(22 + (234 - 22) * t);
        g = Math.round(163 + (179 - 163) * t);
        b = Math.round(74 + (8 - 74) * t);
      } else {
        const t = (intensity - 0.5) / 0.5;
        r = Math.round(234 + (220 - 234) * t);
        g = Math.round(179 + (38 - 179) * t);
        b = Math.round(8 + (38 - 8) * t);
      }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, segW, h);
      x += segW;
    }

    // Fill rounding loss
    if (x < w) {
      ctx.fillRect(x, 0, w - x, h);
    }

    // Update labels: start / end only
    const firstTime = snapshots[0].time || 0;
    const lastTime = snapshots[snapshots.length - 1].time || 0;
    const labelsEl = document.getElementById('timeline-labels');
    if (labelsEl) {
      labelsEl.innerHTML =
        `<span>${formatTimeLabel(firstTime) || 'Start'}</span>` +
        `<span></span>` +
        `<span>${formatTimeLabel(lastTime) || 'End'}</span>`;
    }

    // Update legend
    const legendEl = document.getElementById('timeline-legend');
    if (legendEl) {
      legendEl.innerHTML =
        `<span class="legend-swatch" style="background:#16a34a"></span>` +
        `<span>Low edit rate</span>` +
        `<span class="legend-swatch" style="background:#eab308;margin-left:8px"></span>` +
        `<span>Moderate</span>` +
        `<span class="legend-swatch" style="background:#dc2626;margin-left:8px"></span>` +
        `<span>High edit rate</span>` +
        `<span class="legend-swatch" style="background:#d1d5db;margin-left:8px"></span>` +
        `<span>Idle \u2265${idleMin} min</span>`;
    }
  }

  function updateStats() {
    if (!snapshots.length) {
      statsText.textContent = 'No data';
      return;
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const totalTime = last.time - first.time;
    const totalChars = last.text.length;
    const totalRevisions = snapshots.length;

    const fmtTime = totalTime > 0
      ? formatDuration(totalTime / 1000)
      : 'unknown';

    const currTime = snapshots[currentIndex].time || 0;
    const currTimeStr = formatTimeLabel(currTime);
    const timePart = currTimeStr ? ` | ${currTimeStr}` : '';

    statsText.textContent =
      `Rev ${currentIndex} / ${totalRevisions}${timePart} | Duration: ${fmtTime} | Final: ${totalChars} chars`;
  }

  function formatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function seekTo(index) {
    index = Math.max(0, Math.min(snapshots.length - 1, index));
    currentIndex = index;
    renderCurrent();
  }

  function togglePlay() {
    if (!snapshots.length) return;
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function play() {
    if (currentIndex >= snapshots.length - 1) {
      seekTo(0);
    }
    isPlaying = true;
    setPlayIcon(true);
    tick();
  }

  function pause() {
    isPlaying = false;
    setPlayIcon(false);
    if (playbackTimer) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }
  }

  function tick() {
    if (!isPlaying) return;
    if (currentIndex >= snapshots.length - 1) {
      pause();
      playBtn.title = 'Replay';
      return;
    }

    if (playbackMode === 'live') {
      const gap = Math.max(50, (snapshots[currentIndex + 1].time || 0) - (snapshots[currentIndex].time || 0));
      const wait = gap / playbackSpeed;
      seekTo(currentIndex + 1);
      playbackTimer = setTimeout(tick, wait);
      return;
    }

    // Step mode: advance one revision per tick, skipping idle gaps
    let nextIdx = currentIndex + 1;
    let skipped = 0;
    while (nextIdx < snapshots.length - 1) {
      const gap = (snapshots[nextIdx].time || 0) - (snapshots[nextIdx - 1].time || 0);
      if (gap >= idleThreshold) {
        skipped++;
        nextIdx++;
      } else {
        break;
      }
    }

    if (skipped > 0) {
      contentArea.classList.add('idle-skip');
      setTimeout(() => contentArea.classList.remove('idle-skip'), 80);
    }

    seekTo(nextIdx);
    const baseDelay = 50;
    playbackTimer = setTimeout(tick, baseDelay / (playbackSpeed / 4));
  }

  function changeSpeed(delta) {
    const speeds = [0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
    let idx = speeds.indexOf(playbackSpeed);
    if (idx === -1) idx = 3;
    idx = Math.max(0, Math.min(speeds.length - 1, idx + delta));
    playbackSpeed = speeds[idx];
    speedDisplay.textContent = `${playbackSpeed}x`;
  }

  playBtn.addEventListener('click', togglePlay);

  document.getElementById('fwd-btn').addEventListener('click', () => {
    changeSpeed(1);
  });

  document.getElementById('slow-btn').addEventListener('click', () => {
    changeSpeed(-1);
  });

  document.getElementById('skip-back').addEventListener('click', () => {
    seekTo(currentIndex - 50);
  });

  document.getElementById('skip-fwd').addEventListener('click', () => {
    seekTo(currentIndex + 50);
  });

  document.getElementById('skip-end').addEventListener('click', () => {
    seekTo(snapshots.length - 1);
    pause();
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    seekTo(0);
    pause();
  });

  const modeToggle = document.getElementById('mode-toggle');
  const modeLabels = document.querySelectorAll('.mode-label');
  const modeInfoBtn = document.getElementById('mode-info-btn');
  const modeInfoPopup = document.getElementById('mode-info-popup');

  function setMode(mode) {
    playbackMode = mode;
    modeToggle.checked = mode === 'live';
    modeLabels.forEach(l => l.classList.toggle('active', l.dataset.mode === mode));
    updateRevTime();
  }

  modeToggle.addEventListener('change', () => {
    setMode(modeToggle.checked ? 'live' : 'step');
  });

  modeInfoBtn.addEventListener('click', () => {
    modeInfoBtn.classList.toggle('active');
    modeInfoPopup.classList.toggle('visible');
  });
  document.addEventListener('click', (e) => {
    if (!modeInfoBtn.contains(e.target) && !modeInfoPopup.contains(e.target)) {
      modeInfoPopup.classList.remove('visible');
      modeInfoBtn.classList.remove('active');
    }
  });

  setMode('step');

  const revTimeEl = document.getElementById('rev-time');

  function updateRevTime() {
    if (!snapshots.length) return;
    if (playbackMode === 'live') {
      const t = snapshots[currentIndex].time || 0;
      const label = formatTimeLabel(t);
      revTimeEl.textContent = label ? `| ${label}` : '';
    } else {
      revTimeEl.textContent = '';
    }
  }

  seekBar.addEventListener('input', () => {
    const wasPlaying = isPlaying;
    pause();
    seekTo(parseInt(seekBar.value));
  });

  seekBar.addEventListener('change', () => {
    if (isPlaying) play();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight') seekTo(currentIndex + 1);
    if (e.code === 'ArrowLeft') seekTo(currentIndex - 1);
    if (e.code === 'ArrowUp') e.preventDefault(), 0;
    if (e.code === 'ArrowDown') e.preventDefault(), 0;
  });

  timeline.addEventListener('click', (e) => {
    if (snapshots.length < 2) return;
    const rect = timeline.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const wasPlaying = isPlaying;
    pause();
    seekTo(snapIdxAtFraction(frac));
  });

  // Hover tooltip on timeline
  const hoverEl = document.getElementById('timeline-hover');
  const hoverLine = document.getElementById('timeline-hover-line');

  timeline.addEventListener('mousemove', (e) => {
    if (snapshots.length < 2) return;
    const rect = timeline.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = px / rect.width;
    const snapIdx = snapIdxAtFraction(frac);
    const time = snapshots[snapIdx].time || 0;
    const label = formatTimeLabel(time);
    if (label) {
      hoverEl.textContent = label;
      hoverEl.style.left = `${Math.round(px)}px`;
      hoverEl.classList.add('visible');
      hoverLine.style.left = `${Math.round(px)}px`;
      hoverLine.classList.add('visible');
    }
  });

  timeline.addEventListener('mouseleave', () => {
    hoverEl.classList.remove('visible');
    hoverLine.classList.remove('visible');
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    if (!snapshots.length) return;
    const exportData = snapshots.map((s, i) => ({
      rev: i,
      time: s.time,
      text: s.text,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opendraft-${docId || 'export'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  window.addEventListener('resize', () => {
    updateTimeline();
    updateMarker();
  });

  setTimeout(build, 100);
})();
