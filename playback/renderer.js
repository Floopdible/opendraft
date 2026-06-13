function renderSnapshot(snapshot, prevSnapshot) {
  const { text, styles, chars } = snapshot;
  const prevText = prevSnapshot ? prevSnapshot.text : '';
  const prevStyles = prevSnapshot ? prevSnapshot.styles : [];

  const diffs = computeDiff(text, prevText);
  const container = document.createElement('div');
  container.className = 'doc-content';

  const para = document.createElement('div');
  para.className = 'doc-paragraph';
  container.appendChild(para);

  if (text.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'doc-empty';
    empty.textContent = '\u00B6';
    para.appendChild(empty);
    return container;
  }

  let span = null;
  let spanStyle = -1;

  function flushSpan() {
    if (span && span.textContent.length > 0) {
      para.appendChild(span);
    }
    span = null;
    spanStyle = -1;
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const style = styles && i < styles.length ? styles[i] : 0;
    const isNew = diffs && diffs.newSet && diffs.newSet.has(i);
    const isRemoved = diffs && diffs.removedSet && diffs.removedSet.has(i);

    if (style !== spanStyle || isNew || isRemoved) {
      flushSpan();
      span = document.createElement('span');
      spanStyle = style;
      if (style & 1) span.style.fontWeight = 'bold';
      if (style & 2) span.style.fontStyle = 'italic';
      if (style & 4) span.style.textDecoration = 'underline';
      if (style & 8) span.style.textDecoration = 'line-through';
      if (isNew) span.className = 'diff-insert';
      if (isRemoved) span.className = 'diff-delete';
    }

    if (ch === '\n') {
      flushSpan();
      const br = document.createElement('br');
      para.appendChild(br);
    } else if (ch === '\t') {
      span.appendChild(document.createTextNode('    '));
    } else {
      const node = document.createTextNode(ch);
      span.appendChild(node);
    }
  }
  flushSpan();

  return container;
}

function computeDiff(text, prevText) {
  if (!prevText) return null;
  if (text === prevText) return null;

  const commonPrefix = sharedPrefix(text, prevText);
  const commonSuffix = sharedSuffix(text.slice(commonPrefix), prevText.slice(commonPrefix));

  const newText = text.slice(commonPrefix, text.length - commonSuffix);
  const oldText = prevText.slice(commonPrefix, prevText.length - commonSuffix);

  const newSet = new Set();
  for (let i = commonPrefix; i < text.length - commonSuffix; i++) {
    newSet.add(i);
  }
  const removedSet = new Set();
  for (let i = commonPrefix; i < prevText.length - commonSuffix; i++) {
    removedSet.add(i);
  }

  return { newSet, removedSet, newText, oldText };
}

function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function sharedSuffix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
