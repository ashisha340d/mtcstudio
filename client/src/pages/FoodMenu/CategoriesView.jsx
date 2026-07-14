import { useState, useEffect, useRef, useCallback } from 'react';
import { categoriesApi } from '../../services/api';
import { useMsg } from '../../hooks/useApi';

const COLS = ['name', 'slug', 'description', 'sort_order', 'status'];

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('sort_order');
  const [loading, setLoading] = useState(true);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [activeCell, setActiveCell] = useState(null); // { rowIdx, colIdx }
  const [dragSrc, setDragSrc] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const { msg, showMsg } = useMsg();
  const searchRef = useRef(null);
  // cellRefs[rowIdx][colIdx] = DOM element
  const cellRefs = useRef([]);

  async function load(s = search, so = sort) {
    setLoading(true);
    try {
      const res = await categoriesApi.list({ search: s, sort: so });
      setCategories(res.data);
      setDirtyIds(new Set());
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Ctrl/Cmd+S → Save All
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveAll();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [categories, dirtyIds]);

  function handleSearch(e) {
    e.preventDefault();
    load(search, sort);
  }

  function handleSort(col) {
    setSort(col);
    load(search, col);
  }

  function SortTh({ col, label }) {
    return (
      <th onClick={() => handleSort(col)} style={{ cursor: 'pointer' }}>
        {label} {sort === col && <span style={{ color: '#f90' }}>▲</span>}
      </th>
    );
  }

  async function saveRow(cat) {
    try {
      if (cat.id === 'new') {
        const res = await categoriesApi.create(cat);
        setCategories(prev => prev.map(c => c.id === 'new' ? res.data.category : c));
      } else {
        await categoriesApi.update(cat.id, cat);
      }
      setDirtyIds(prev => { const n = new Set(prev); n.delete(cat.id); return n; });
      showMsg('Saved!');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function saveAll() {
    const toSave = categories.filter(c => dirtyIds.has(c.id));
    if (!toSave.length) return;
    try {
      await Promise.all(toSave.map(cat =>
        cat.id === 'new'
          ? categoriesApi.create(cat).then(res =>
              setCategories(prev => prev.map(c => c.id === 'new' ? res.data.category : c))
            )
          : categoriesApi.update(cat.id, cat)
      ));
      setDirtyIds(new Set());
      showMsg(`Saved ${toSave.length} change${toSave.length > 1 ? 's' : ''}!`);
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  async function deleteRow(id) {
    if (id === 'new') {
      setCategories(prev => prev.filter(c => c.id !== 'new'));
      setDirtyIds(prev => { const n = new Set(prev); n.delete('new'); return n; });
      return;
    }
    if (!window.confirm('Delete this category?')) return;
    try {
      await categoriesApi.remove(id);
      setCategories(prev => prev.filter(c => c.id !== id));
      setDirtyIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      showMsg('Deleted');
    } catch (e) {
      showMsg(e.response?.data?.error || e.message, false);
    }
  }

  function addRow() {
    const newRow = { id: 'new', name: '', slug: '', description: '', sort_order: 0, status: 'active' };
    setCategories(prev => [newRow, ...prev]);
    setDirtyIds(prev => new Set([...prev, 'new']));
    setTimeout(() => focusCell(0, 0), 50);
  }

  function updateField(id, field, value) {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
    setDirtyIds(prev => new Set([...prev, id]));
  }

  function setRef(rowIdx, colIdx, el) {
    if (!cellRefs.current[rowIdx]) cellRefs.current[rowIdx] = [];
    cellRefs.current[rowIdx][colIdx] = el;
  }

  function focusCell(rowIdx, colIdx) {
    const el = cellRefs.current[rowIdx]?.[colIdx];
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function') el.select();
    setActiveCell({ rowIdx, colIdx });
  }

  function navigate(rowIdx, colIdx, direction) {
    const numRows = categories.length;
    const numCols = COLS.length;

    let r = rowIdx, c = colIdx;

    if (direction === 'next') {
      c++;
      if (c >= numCols) { c = 0; r++; }
      if (r >= numRows) { r = 0; }
    } else if (direction === 'prev') {
      c--;
      if (c < 0) { c = numCols - 1; r--; }
      if (r < 0) { r = numRows - 1; }
    } else if (direction === 'down') {
      r = (r + 1) % numRows;
    } else if (direction === 'up') {
      r = (r - 1 + numRows) % numRows;
    } else if (direction === 'right') {
      c = (c + 1) % numCols;
    } else if (direction === 'left') {
      c = (c - 1 + numCols) % numCols;
    }

    focusCell(r, c);
  }

  function makeCellKeyHandler(rowIdx, colIdx, isTextarea = false) {
    return function (e) {
      if (e.key === 'Enter') {
        if (isTextarea && e.shiftKey) return; // Shift+Enter in textarea = new line
        e.preventDefault();
        navigate(rowIdx, colIdx, e.shiftKey ? 'prev' : 'next');
      } else if (e.key === 'ArrowRight' && !isTextarea) {
        e.preventDefault();
        navigate(rowIdx, colIdx, 'right');
      } else if (e.key === 'ArrowLeft' && !isTextarea) {
        e.preventDefault();
        navigate(rowIdx, colIdx, 'left');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigate(rowIdx, colIdx, 'down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigate(rowIdx, colIdx, 'up');
      }
    };
  }

  function onCellFocus(rowIdx, colIdx, e) {
    setActiveCell({ rowIdx, colIdx });
    if (typeof e.target.select === 'function') e.target.select();
  }

  function isActive(rowIdx, colIdx) {
    return activeCell?.rowIdx === rowIdx && activeCell?.colIdx === colIdx;
  }

  function onDragStart(e, idx) {
    setDragSrc(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }

  function onDragOver(e, idx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== idx) setDragOver(idx);
  }

  function onDragEnd() {
    setDragSrc(null);
    setDragOver(null);
  }

  async function onDrop(e, idx) {
    e.preventDefault();
    if (dragSrc === null || dragSrc === idx) { onDragEnd(); return; }
    setCategories(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(dragSrc, 1);
      arr.splice(idx, 0, moved);
      arr.forEach((cat, i) => { cat.sort_order = i + 1; });
      // persist new order immediately (fire-and-forget, no dirty state needed)
      const ids = arr.map(c => c.id).filter(id => id !== 'new');
      categoriesApi.reorder(ids).catch(err => showMsg(err.message, false));
      return arr;
    });
    onDragEnd();
  }

  const dirtyCount = dirtyIds.size;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div className="toolbar">
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search categories…"
          />
          <button type="submit" className="btn btn-primary">Search</button>
          {search && (
            <button type="button" className="btn btn-clear" onClick={() => { setSearch(''); load('', sort); }}>
              Clear
            </button>
          )}
        </form>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-add" onClick={addRow}>+ Add Category</button>
          <button
            className="btn btn-save"
            onClick={saveAll}
            disabled={dirtyCount === 0}
            style={{ opacity: dirtyCount === 0 ? 0.5 : 1 }}
          >
            Save All{dirtyCount > 0 ? ` (${dirtyCount})` : ''}
          </button>
        </div>
        {msg && <span className={`msg msg-${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>}
      </div>

      <div className="table-wrap" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }}>
        {loading ? <p style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }} title="Drag to reorder"></th>
                <th className="col-id">ID</th>
                <SortTh col="name" label="Name" />
                <SortTh col="slug" label="Slug" />
                <th>Description</th>
                <SortTh col="sort_order" label="Order" />
                <SortTh col="status" label="Status" />
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, rowIdx) => {
                const isDirty  = dirtyIds.has(cat.id);
                const isDragSrc = dragSrc === rowIdx;
                const isDragOv  = dragOver === rowIdx && dragSrc !== rowIdx;
                const rowStyle = {
                  ...(isDirty  ? { background: cat.id === 'new' ? '#fffde7' : '#f0f7ff' } : {}),
                  ...(isDragSrc ? { opacity: 0.4 } : {}),
                  ...(isDragOv  ? { outline: '2px solid #2563eb', outlineOffset: -2 } : {}),
                };

                return (
                  <tr
                    key={cat.id}
                    style={rowStyle}
                    onDragOver={e => onDragOver(e, rowIdx)}
                    onDragEnd={onDragEnd}
                    onDrop={e => onDrop(e, rowIdx)}
                  >
                    {/* Drag handle */}
                    <td
                      draggable
                      onDragStart={e => onDragStart(e, rowIdx)}
                      title="Drag to reorder"
                      style={{
                        cursor: 'grab', textAlign: 'center', color: '#9ca3af',
                        fontSize: 16, userSelect: 'none', width: 32,
                      }}
                    >⠿</td>
                    <td className="col-id">{cat.id === 'new' ? '–' : cat.id}</td>

                    {/* Name */}
                    <td>
                      <input
                        ref={el => setRef(rowIdx, 0, el)}
                        className={`cell${isActive(rowIdx, 0) ? ' cell-active' : ''}`}
                        value={cat.name}
                        onChange={e => updateField(cat.id, 'name', e.target.value)}
                        onFocus={e => onCellFocus(rowIdx, 0, e)}
                        onKeyDown={makeCellKeyHandler(rowIdx, 0)}
                      />
                    </td>

                    {/* Slug */}
                    <td>
                      <input
                        ref={el => setRef(rowIdx, 1, el)}
                        className={`cell${isActive(rowIdx, 1) ? ' cell-active' : ''}`}
                        value={cat.slug || ''}
                        onChange={e => updateField(cat.id, 'slug', e.target.value)}
                        onFocus={e => onCellFocus(rowIdx, 1, e)}
                        onKeyDown={makeCellKeyHandler(rowIdx, 1)}
                      />
                    </td>

                    {/* Description */}
                    <td>
                      <textarea
                        ref={el => setRef(rowIdx, 2, el)}
                        className={`cell${isActive(rowIdx, 2) ? ' cell-active' : ''}`}
                        rows={1}
                        value={cat.description || ''}
                        onChange={e => updateField(cat.id, 'description', e.target.value)}
                        onFocus={e => onCellFocus(rowIdx, 2, e)}
                        onKeyDown={makeCellKeyHandler(rowIdx, 2, true)}
                      />
                    </td>

                    {/* Order */}
                    <td className="col-order">
                      <input
                        ref={el => setRef(rowIdx, 3, el)}
                        className={`cell${isActive(rowIdx, 3) ? ' cell-active' : ''}`}
                        type="number"
                        value={cat.sort_order}
                        onChange={e => updateField(cat.id, 'sort_order', e.target.value)}
                        onFocus={e => onCellFocus(rowIdx, 3, e)}
                        onKeyDown={makeCellKeyHandler(rowIdx, 3)}
                      />
                    </td>

                    {/* Status */}
                    <td className="col-status">
                      <select
                        ref={el => setRef(rowIdx, 4, el)}
                        className={`cell${isActive(rowIdx, 4) ? ' cell-active' : ''}`}
                        value={cat.status}
                        onChange={e => updateField(cat.id, 'status', e.target.value)}
                        onFocus={e => onCellFocus(rowIdx, 4, e)}
                        onKeyDown={makeCellKeyHandler(rowIdx, 4)}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>

                    <td className="col-actions">
                      <button className="btn btn-sm btn-save" onClick={() => saveRow(cat)}>Save</button>{' '}
                      <button className="btn btn-sm btn-delete" onClick={() => deleteRow(cat.id)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="pager" style={{ flexShrink: 0 }}>
        Showing {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
        {dirtyCount > 0 && (
          <span style={{ marginLeft: 12, color: '#2563eb', fontSize: '0.85em' }}>
            {dirtyCount} unsaved change{dirtyCount > 1 ? 's' : ''} — press Ctrl+S to save
          </span>
        )}
      </div>
    </div>
  );
}
