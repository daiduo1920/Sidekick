window.KuroKeymap = (function () {
  // Authentic 5-row 65% mechanical keyboard layout matching GlobalInputHook.cs 1-to-1
  const ROW_SPECS = [
    [
      { w: 1.05, accent: true, label: 'ESC', cols: [0] },
      { w: 0.92, label: '1', cols: [1] },
      { w: 0.92, label: '2', cols: [2] },
      { w: 0.92, label: '3', cols: [3] },
      { w: 0.92, label: '4', cols: [4] },
      { w: 0.92, label: '5', cols: [5] },
      { w: 0.92, label: '6', cols: [6] },
      { w: 0.92, label: '7', cols: [7] },
      { w: 0.92, label: '8', cols: [8] },
      { w: 0.92, label: '9', cols: [9] },
      { w: 0.92, label: '0', cols: [10] },
      { w: 1.55, accent: true, label: '←', cols: [11] },
    ],
    [
      { w: 1.40, label: 'TAB', cols: [0] },
      { w: 1.0, label: 'Q', cols: [1] },
      { w: 1.0, label: 'W', cols: [2] },
      { w: 1.0, label: 'E', cols: [3] },
      { w: 1.0, label: 'R', cols: [4] },
      { w: 1.0, label: 'T', cols: [5] },
      { w: 1.0, label: 'Y', cols: [6] },
      { w: 1.0, label: 'U', cols: [7] },
      { w: 1.0, label: 'I', cols: [8] },
      { w: 1.0, label: 'O', cols: [9] },
      { w: 1.40, label: 'P', cols: [10] },
    ],
    [
      { w: 1.62, label: 'CAPS', cols: [0] },
      { w: 0.98, label: 'A', cols: [1] },
      { w: 0.98, label: 'S', cols: [2] },
      { w: 0.98, label: 'D', cols: [3] },
      { w: 0.98, label: 'F', cols: [4] },
      { w: 0.98, label: 'G', cols: [5] },
      { w: 0.98, label: 'H', cols: [6] },
      { w: 0.98, label: 'J', cols: [7] },
      { w: 0.98, label: 'K', cols: [8] },
      { w: 0.98, label: 'L', cols: [9] },
      { w: 1.36, accent: true, label: '↵', cols: [10] },
    ],
    [
      { w: 1.78, accent: true, label: '⇧', cols: [0] },
      { w: 0.96, label: 'Z', cols: [1] },
      { w: 0.96, label: 'X', cols: [2] },
      { w: 0.96, label: 'C', cols: [3] },
      { w: 0.96, label: 'V', cols: [4] },
      { w: 0.96, label: 'B', cols: [5] },
      { w: 0.96, label: 'N', cols: [6] },
      { w: 0.96, label: 'M', cols: [7] },
      { w: 0.92, label: ',', cols: [8] },
      { w: 0.92, label: '.', cols: [9] },
      { w: 1.46, accent: true, label: '⇧', cols: [10] },
    ],
    [
      { w: 1.28, label: 'CTRL', cols: [0] },
      { w: 1.05, label: '⌘', cols: [1] },
      { w: 1.15, label: 'ALT', cols: [2] },
      { w: 4.52, isSpace: true, label: '', cols: [3] },
      { w: 1.04, label: 'FN', cols: [4] },
      { w: 0.92, label: '◀', cols: [5] },
      { w: 0.92, label: '▼', cols: [6] },
      { w: 0.92, accent: true, label: '▶', cols: [7] },
    ],
  ];

  const ROW_COUNT = ROW_SPECS.length;
  const KEYS = [];
  const LOOKUP = {};
  let spaceIndex = 0;

  ROW_SPECS.forEach((specs, rowIdx) => {
    const totalW = specs.reduce((a, b) => a + b.w, 0);
    let cursor = 0;
    specs.forEach((s) => {
      const idx = KEYS.length;
      const u0 = cursor / totalW;
      const u1 = (cursor + s.w) / totalW;
      const key = {
        index: idx,
        row: rowIdx,
        u0, u1,
        uc: (u0 + u1) * 0.5,
        uw: u1 - u0,
        v0: rowIdx / ROW_COUNT,
        v1: (rowIdx + 1) / ROW_COUNT,
        vc: (rowIdx + 0.5) / ROW_COUNT,
        vh: 1 / ROW_COUNT,
        accent: !!s.accent,
        isSpace: !!s.isSpace,
        label: s.label || '',
      };
      KEYS.push(key);
      if (s.isSpace) spaceIndex = idx;
      s.cols.forEach((c) => { LOOKUP[rowIdx + ':' + c] = idx; });
      cursor += s.w;
    });
  });

  function resolveKeyIndex(row, col, kind) {
    if (kind === 2) return spaceIndex;
    const r = Math.max(0, Math.min(ROW_COUNT - 1, row | 0));
    const c = Math.max(0, Math.min(11, col | 0));
    if (LOOKUP[r + ':' + c] !== undefined) return LOOKUP[r + ':' + c];
    // Fallback to nearest valid col on that row
    for (let dc = 1; dc <= 11; dc++) {
      if (LOOKUP[r + ':' + (c - dc)] !== undefined) return LOOKUP[r + ':' + (c - dc)];
      if (LOOKUP[r + ':' + (c + dc)] !== undefined) return LOOKUP[r + ':' + (c + dc)];
    }
    return spaceIndex;
  }

  return { keys: KEYS, count: KEYS.length, rowCount: ROW_COUNT, spaceIndex, resolveKeyIndex };
})();
