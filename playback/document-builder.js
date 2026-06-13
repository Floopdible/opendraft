function applyStyle(charStyle, cmd) {
  let s = charStyle;
  if (cmd.fs_bold !== undefined) s = (s & ~1) | (cmd.fs_bold ? 1 : 0);
  if (cmd.fs_italic !== undefined) s = (s & ~2) | (cmd.fs_italic ? 2 : 0);
  if (cmd.fs_underline !== undefined) s = (s & ~4) | (cmd.fs_underline ? 4 : 0);
  if (cmd.fs_strikethrough !== undefined) s = (s & ~8) | (cmd.fs_strikethrough ? 8 : 0);
  return s;
}

function applyCommands(commands, chars, charStyles) {
  for (const cmd of commands) {
    const ty = cmd.ty || cmd.type;
    if (!ty) continue;

    if (ty === 'is' || ty === 'iss' || ty === 'insert') {
      const idx = (cmd.ibi !== undefined ? cmd.ibi - 1 : cmd.index) || 0;
      const str = cmd.s || cmd.text || cmd.string || '';
      for (let i = 0; i < str.length; i++) {
        chars.splice(idx + i, 0, str[i]);
        charStyles.splice(idx + i, 0, 0);
      }
      continue;
    }

    if (ty === 'ds' || ty === 'dss' || ty === 'delete') {
      const start = (cmd.si !== undefined ? cmd.si - 1 : cmd.dbi !== undefined ? cmd.dbi : cmd.start) || 0;
      const end = (cmd.ei !== undefined ? cmd.ei - 1 : cmd.dei !== undefined ? cmd.dei : cmd.end);
      const count = end !== undefined ? end - start + 1 : (cmd.count || 1);
      chars.splice(start, count);
      charStyles.splice(start, count);
      continue;
    }

    if (ty === 'fs' || ty === 'style' || ty === 'format') {
      const start = (cmd.sbi !== undefined ? cmd.sbi - 1 : cmd.start) || 0;
      const end = (cmd.sei !== undefined ? cmd.sei - 1 : cmd.end);
      for (let i = start; i < end && i < charStyles.length; i++) {
        charStyles[i] = applyStyle(charStyles[i], cmd);
      }
      continue;
    }

    if (ty === 'ms' || ty === 'multi' || ty === 'mlti') {
      const subs = cmd.mts || cmd.commands || cmd.operations || cmd.ops || [];
      applyCommands(subs, chars, charStyles);
      continue;
    }

    if (ty === 'rplc' || ty === 'rvrt') {
      const subs = cmd.snapshot || [];
      applyCommands(subs, chars, charStyles);
      continue;
    }
  }
}

function getCurrentText(chars) {
  return chars.join('');
}

function extractCommands(rev) {
  if (rev.data && rev.data.commands) return rev.data.commands;
  if (rev.commands) return rev.commands;
  if (rev.data && rev.data.operations) return rev.data.operations;
  if (rev.operations) return rev.operations;
  if (rev.data && Array.isArray(rev.data)) return rev.data;
  if (Array.isArray(rev)) return rev;
  // Handle single command
  if (rev.ty) return [rev];
  return [];
}

function getTimestamp(rev) {
  return rev.timestamp_usec || rev.timestamp || rev.time || 0;
}

function buildRevisionSnapshots(revisions) {
  const chars = [];
  const charStyles = [];
  const snapshots = [];

  for (let i = 0; i < revisions.length; i++) {
    const rev = revisions[i];
    const commands = extractCommands(rev);
    applyCommands(commands, chars, charStyles);
    snapshots.push({
      time: getTimestamp(rev),
      text: getCurrentText(chars),
      styles: charStyles.slice(),
      chars: chars.slice(),
    });
  }

  return snapshots;
}
