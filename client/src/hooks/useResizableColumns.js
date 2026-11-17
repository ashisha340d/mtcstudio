import { useCallback, useRef } from 'react';

/**
 * Makes a <table> column-resizable with widths persisted to localStorage.
 * Usage:  const tableRef = useResizableColumns('crm.customers');  <table ref={tableRef}>
 *
 * Drag the right edge of any header cell. On first drag the current pixel
 * widths are frozen into a <colgroup> and the table switches to fixed layout.
 *
 * Widths are keyed by each header's `data-col-key` (falls back to index) so
 * hiding, showing, or reordering columns keeps every column's own width. When
 * the visible column set changes, remount the table (e.g. a changing `key`
 * prop) so this ref callback re-runs and rebuilds the colgroup.
 */
export default function useResizableColumns(key, gripClass = 'ui-col-resizer') {
  const storageKey = `ui.cols.${key}`;
  const tableRef = useRef(null);
  const keysRef = useRef([]);
  const stateRef = useRef({ col: -1, startX: 0, startW: 0 });

  const saved = useCallback(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  }, [storageKey]);

  // Create the colgroup, or rebuild it if the column count changed.
  const ensureColgroup = useCallback((table, n) => {
    let cg = table.querySelector('colgroup[data-rz]');
    if (cg && cg.children.length !== n) { cg.remove(); cg = null; }
    if (!cg) {
      cg = document.createElement('colgroup');
      cg.setAttribute('data-rz', '1');
      for (let i = 0; i < n; i++) cg.appendChild(document.createElement('col'));
      table.insertBefore(cg, table.firstChild);
    }
    return cg;
  }, []);

  const onMouseMove = useCallback((e) => {
    const st = stateRef.current;
    if (st.col < 0) return;
    const table = tableRef.current;
    if (!table) return;
    const cg = table.querySelector('colgroup[data-rz]');
    const w = Math.max(48, st.startW + (e.clientX - st.startX));
    cg.children[st.col].style.width = w + 'px';
  }, []);

  const onMouseUp = useCallback(() => {
    const st = stateRef.current;
    if (st.col < 0) return;
    const table = tableRef.current;
    const cg = table && table.querySelector('colgroup[data-rz]');
    if (cg) {
      const map = saved() && !Array.isArray(saved()) ? saved() : {};
      const keys = keysRef.current;
      Array.from(cg.children).forEach((c, i) => {
        const w = parseInt(c.style.width, 10) || c.offsetWidth;
        map[keys[i] || ('#' + i)] = w;
      });
      try { localStorage.setItem(storageKey, JSON.stringify(map)); } catch { /* quota */ }
    }
    st.col = -1;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove, saved, storageKey]);

  const startDrag = useCallback((e, table, headers, idx) => {
    e.preventDefault(); e.stopPropagation();
    const cg = ensureColgroup(table, headers.length);
    for (let i = 0; i < headers.length; i++) {
      if (!cg.children[i].style.width) cg.children[i].style.width = headers[i].offsetWidth + 'px';
    }
    table.style.tableLayout = 'fixed';
    stateRef.current = { col: idx, startX: e.clientX, startW: cg.children[idx].offsetWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [ensureColgroup, onMouseMove, onMouseUp]);

  // Ref callback: install resizer grips + apply saved widths by column key.
  return useCallback((table) => {
    tableRef.current = table;
    if (!table) return;
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    const headers = Array.from(headerRow.children);
    const keys = headers.map((th, i) => th.dataset.colKey || ('#' + i));
    keysRef.current = keys;

    const w = saved();
    if (w) {
      const cg = ensureColgroup(table, headers.length);
      headers.forEach((th, i) => {
        const width = Array.isArray(w) ? w[i] : w[keys[i]];
        if (width) cg.children[i].style.width = width + 'px';
      });
      table.style.tableLayout = 'fixed';
    }

    headers.forEach((th, idx) => {
      if (idx === headers.length - 1) return;            // don't resize the last column
      if (th.querySelector('.' + gripClass)) return;      // already installed
      th.style.position = 'relative';
      const grip = document.createElement('span');
      grip.className = gripClass;
      grip.addEventListener('mousedown', (e) => startDrag(e, table, headers, idx));
      grip.addEventListener('click', (e) => e.stopPropagation());
      th.appendChild(grip);
    });
  }, [saved, ensureColgroup, startDrag, gripClass]);
}
