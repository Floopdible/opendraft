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

  const { revisions } = data;
  let snapshots = [];
  let currentIndex = 0;
  let isPlaying = false;
  let playbackTimer = null;
  let playbackSpeed = 4;

  const contentArea = document.getElementById('content');
  const timeline = document.getElementById('timeline');
  const playBtn = document.getElementById('play-btn');
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

    seekBar.max = snapshots.length - 1;
    seekBar.value = 0;
    revCurrent.textContent = '0';
    updateStats();
    renderCurrent();
    updateTimeline();
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
  }

  function updateTimeline() {
    timeline.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = timeline.clientWidth || 600;
    canvas.height = 40;
    timeline.appendChild(canvas);

    if (snapshots.length === 0) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const barHeight = 20;
    const y = (h - barHeight) / 2;

    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, y, w, barHeight);

    const segmentWidth = Math.max(1, w / snapshots.length);
    let prevText = '';
    let density = 0;

    for (let i = 0; i < snapshots.length; i++) {
      const text = snapshots[i].text;
      const diff = text.length - prevText.length;
      const churn = Math.abs(diff) + (diff === 0 && text !== prevText ? 1 : 0);
      density += churn;
      prevText = text;
    }

    const avgDensity = density / snapshots.length;
    prevText = '';

    for (let i = 0; i < snapshots.length; i++) {
      const text = snapshots[i].text;
      const diff = text.length - prevText.length;
      const churn = Math.abs(diff) + (diff === 0 && text !== prevText ? 1 : 0);
      const intensity = Math.min(1, churn / (avgDensity * 3 || 1));

      const r = Math.round(59 + (239 - 59) * intensity);
      const g = Math.round(130 + (68 - 130) * (1 - intensity));
      const b = Math.round(246 + (68 - 246) * (1 - intensity));

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(i * segmentWidth, y, Math.max(1, segmentWidth), barHeight);
      prevText = text;
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

    statsText.textContent =
      `Revisions: ${totalRevisions} | Final size: ${totalChars} chars | Duration: ${fmtTime}`;
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
    playBtn.textContent = '⏸';
    playBtn.title = 'Pause';
    tick();
  }

  function pause() {
    isPlaying = false;
    playBtn.textContent = '▶';
    playBtn.title = 'Play';
    if (playbackTimer) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }
  }

  function tick() {
    if (!isPlaying) return;
    if (currentIndex >= snapshots.length - 1) {
      pause();
      playBtn.textContent = '⟳';
      playBtn.title = 'Replay';
      return;
    }
    seekTo(currentIndex + 1);
    const baseDelay = 50;
    playbackTimer = setTimeout(tick, baseDelay / (playbackSpeed / 4));
  }

  function changeSpeed(delta) {
    const speeds = [0.5, 1, 2, 4, 8, 16, 32];
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

  document.getElementById('reset-btn').addEventListener('click', () => {
    seekTo(0);
    pause();
  });

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

  window.addEventListener('resize', () => {
    updateTimeline();
  });

  setTimeout(build, 100);
})();
