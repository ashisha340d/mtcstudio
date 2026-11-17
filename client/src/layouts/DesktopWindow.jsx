import { useRef, useCallback } from 'react';

/**
 * Draggable, resizable, minimizable, maximizable floating window.
 * Pure CSS transitions — no external animation library needed.
 */
export default function DesktopWindow({
  win,                // { id, key, title, icon, x, y, w, h, minimized, maximized, zIndex }
  isFocused,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onMove,             // (id, x, y) => void
  onResize,           // (id, w, h, x, y) => void
  children,
}) {
  const winRef   = useRef(null);
  const dragRef  = useRef(null);
  const resRef   = useRef(null);

  /* ── Drag ─────────────────────────────────────────────── */
  const handleTitleMouseDown = useCallback((e) => {
    if (win.maximized) return;
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { ox: e.clientX - win.x, oy: e.clientY - win.y };

    const onMove_ = (ev) => {
      if (!dragRef.current) return;
      const nx = Math.max(0, Math.min(window.innerWidth  - 120, ev.clientX - dragRef.current.ox));
      const ny = Math.max(38, Math.min(window.innerHeight -  40, ev.clientY - dragRef.current.oy));
      onMove(win.id, nx, ny);
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove_); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  }, [win, onMove]);

  /* ── Resize (bottom-right handle) ────────────────────── */
  const handleResizeMouseDown = useCallback((e) => {
    if (win.maximized) return;
    e.preventDefault();
    e.stopPropagation();
    resRef.current = { sx: e.clientX, sy: e.clientY, sw: win.w, sh: win.h };

    const onMove_ = (ev) => {
      if (!resRef.current) return;
      const nw = Math.max(420, resRef.current.sw + ev.clientX - resRef.current.sx);
      const nh = Math.max(300, resRef.current.sh + ev.clientY - resRef.current.sy);
      onResize(win.id, nw, nh);
    };
    const onUp = () => { resRef.current = null; window.removeEventListener('mousemove', onMove_); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove_);
    window.addEventListener('mouseup', onUp);
  }, [win, onResize]);

  if (win.minimized) return null;

  const isMax = win.maximized;

  const style = isMax
    ? { position: 'fixed', left: 0, top: 38, width: '100vw', height: 'calc(100vh - 38px)', zIndex: win.zIndex, borderRadius: 0 }
    : { position: 'fixed', left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.zIndex };

  return (
    <div
      ref={winRef}
      data-win-id={win.id}
      style={{
        ...style,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--t-bg)',
        border: isFocused ? '1px solid var(--t-border-strong)' : '1px solid var(--t-border)',
        borderRadius: isMax ? 0 : 12,
        boxShadow: isFocused
          ? '0 20px 60px rgba(42,31,18,0.32), 0 4px 16px rgba(42,31,18,0.18), 0 1px 0 rgba(255,255,255,0.7) inset'
          : '0 8px 24px rgba(42,31,18,0.18), 0 1px 0 rgba(255,255,255,0.6) inset',
        overflow: 'hidden',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        userSelect: dragRef.current ? 'none' : 'auto',
      }}
      onMouseDown={onFocus}
    >
      {/* ── Window Chrome ───────────────────────────────── */}
      <div
        onMouseDown={handleTitleMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 14px',
          height: 38,
          flexShrink: 0,
          cursor: isMax ? 'default' : 'move',
          userSelect: 'none',
          background: isFocused
            ? 'linear-gradient(180deg, var(--t-chrome-1) 0%, var(--t-chrome-2) 100%)'
            : 'linear-gradient(180deg, var(--t-chrome-1) 0%, var(--t-chrome-1) 100%)',
          borderBottom: '1px solid var(--t-border-strong)',
          transition: 'background 0.15s',
        }}
      >
        {/* Traffic light dots */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(win.id); }}
            title="Close"
            style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', border: '1px solid rgba(0,0,0,0.18)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'filter 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.85)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
          />
          <button
            onClick={(e) => { e.stopPropagation(); onMinimize(win.id); }}
            title="Minimize"
            style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', border: '1px solid rgba(0,0,0,0.18)', cursor: 'pointer', padding: 0, transition: 'filter 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.85)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
          />
          <button
            onClick={(e) => { e.stopPropagation(); onMaximize(win.id); }}
            title={isMax ? 'Restore' : 'Maximize'}
            style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', border: '1px solid rgba(0,0,0,0.18)', cursor: 'pointer', padding: 0, transition: 'filter 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.85)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
          />
        </div>

        {/* Title */}
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--t-text)', opacity: isFocused ? 1 : 0.65, letterSpacing: '0.04em', textTransform: 'uppercase', pointerEvents: 'none' }}>
          <span style={{ marginRight: 6, fontSize: 13 }}>{win.icon}</span>
          {win.title}
        </div>

        {/* Right spacer to balance dots */}
        <div style={{ width: 54, flexShrink: 0 }} />
      </div>

      {/* ── Content ─────────────────────────────────────── */}
      <div className="desktop-window-body" style={{ flex: 1, overflow: 'auto', position: 'relative' }}
        onContextMenu={e => e.stopPropagation()}>
        {children}
      </div>

      {/* ── Resize handle ───────────────────────────────── */}
      {!isMax && (
        <div
          onMouseDown={handleResizeMouseDown}
          style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 18, height: 18, cursor: 'se-resize',
            background: 'transparent',
            borderBottomRightRadius: 12,
          }}
        />
      )}
    </div>
  );
}
