import { useCallback, useRef } from 'react';

/**
 * Makes a <table> column-resizable with widths persisted to localStorage.
 * Usage:  const tableRef = useResizableColumns('cmp.queue');  <table ref={tableRef}>
 *
 * Drag the right edge of any header cell. On first drag the current pixel
 * widths are frozen into a <colgroup> and the table switches to fixed layout
 * so columns hold their size; every change is saved under `cmp.cols.<key>`.
 */
export default function useResizableColumns(key) {
  const storageKey = `cmp.cols.${key}`;
  const tableRef = useRef(null);
  const stateRef = useRef({ col: -1, startX: 0, startW: 0, cols: [] });

  const saved = useCallback(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
  }, [storageKey]);

  const ensureColgroup = useCallback((table, headers) => {
    let cg = table.querySelector('colgroup[data-rz]');
    if (!cg) {
      cg = document.createElement('colgroup');
      cg.setAttribute('data-rz', '1');
      for (let i = 0; i < headers.length; i++) cg.appendChild(document.createElement('col'));
      table.insertBefore(cg, table.firstChild);
    }
    return cg;
  }, []);

  const applyWidths = useCallback((table, headers, widths) => {
    const cg = ensureColgroup(table, headers);
    const cols = cg.children;
    for (let i = 0; i < cols.length; i++) if (widths[i]) cols[i].style.width = widths[i] + 'px';
    table.style.tableLayout = 'fixed';
  }, [ensureColgroup]);

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
      const widths = Array.from(cg.children).map((c) => parseInt(c.style.width, 10) || c.offsetWidth);
      try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* quota */ }
    }
    st.col = -1;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove, storageKey]);

  const startDrag = useCallback((e, table, headers, idx) => {
    e.preventDefault(); e.stopPropagation();
    // Freeze current widths into the colgroup before the first drag.
    const cg = ensureColgroup(table, headers);
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

  // Ref callback: install resizer grips on the header cells.
  return useCallback((table) => {
    tableRef.current = table;
    if (!table) return;
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    const headers = Array.from(headerRow.children);

    const w = saved();
    if (w && w.length) applyWidths(table, headers, w);

    headers.forEach((th, idx) => {
      if (idx === headers.length - 1) return;            // don't resize the last column
      if (th.querySelector('.cmp-col-resizer')) return;  // already installed
      th.style.position = 'relative';
      const grip = document.createElement('span');
      grip.className = 'cmp-col-resizer';
      grip.addEventListener('mousedown', (e) => startDrag(e, table, headers, idx));
      grip.addEventListener('click', (e) => e.stopPropagation());
      th.appendChild(grip);
    });
  }, [saved, applyWidths, startDrag]);
}
