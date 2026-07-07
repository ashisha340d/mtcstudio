import { useEffect, useState } from 'react';
import { useKDS } from '../../context/KDSContext';
import KOTCard from './components/KOTCard';
import KDSSummary from './components/KDSSummary';
import KDSSettings from './components/KDSSettings';
import KDSReport from './components/KDSReport';
import SocketStatus from '../../components/SocketStatus';
import './kds.css';

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="kds-clock">
      {t.toLocaleTimeString('en-NP', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
    </span>
  );
}

export default function KDSDisplay() {
  const {
    visibleKOTs, servedSearched, settings,
    activeTab, totalPages, safePage,
    filterStatus, loading, servedLoading,
    activeCount, delayedCount, servedCount,
    activeStationName, kdsUser, socket,
    settingsOpen, reportOpen, error,
    loadKOTs, loadServedKOTs,
    setTab, setPage, setFilter,
    openSettings, closeSettings,
    openReport, closeReport,
  } = useKDS();

  useEffect(() => { loadKOTs(); }, []); // eslint-disable-line
  useEffect(() => {
    if (activeTab === 'served') loadServedKOTs();
  }, [activeTab]); // eslint-disable-line

  // Unified view: active | delayed | served | summary
  const view = activeTab === 'summary' ? 'summary'
    : activeTab === 'served' ? 'served'
      : filterStatus === 'delayed' ? 'delayed'
        : 'active';

  const setView = (v) => {
    if (v === 'summary') { setTab('summary'); }
    if (v === 'served') { setTab('served'); }
    if (v === 'active') { setTab('active'); setFilter('all'); }
    if (v === 'delayed') { setTab('active'); setFilter('delayed'); }
  };

  const themeAttr = settings.theme === 'auto' ? undefined : settings.theme;

  const grid = settings.cardDensity;
  const isServedView = view === 'served';
  const isSummaryView = view === 'summary';
  const cards = isServedView ? servedSearched : visibleKOTs;
  const isEmpty = isServedView ? servedSearched.length === 0 : visibleKOTs.length === 0;
  const isLoading = isServedView ? servedLoading : (loading && visibleKOTs.length === 0);

  return (
    <div className="kds-root" data-kds-theme={themeAttr} data-kds-font={settings.fontSize ?? 'small'}>
      {/* ── Single header row ─────────────────────────────── */}
      <div className="kds-header kds-header--single">
        {/* Station name banner */}
        <div className="kds-station-banner" title={activeStationName}>
          {activeStationName}
        </div>

        {/* View toggle: Active | Served | Active Order Summary */}
        <div className="kds-view-toggle">
          <button
            className={`kds-view-btn${view === 'active' || view === 'delayed' ? ' kds-view-btn--active' : ''}`}
            onClick={() => setView('active')}>Active{activeCount ? ` (${activeCount})` : ''}
          </button>

          <button className={`kds-view-btn${isServedView ? ' kds-view-btn--active' : ''}`} onClick={() => setView('served')} >
            Served{servedCount ? ` (${servedCount})` : ''}
          </button>

          <button className={`kds-view-btn${isSummaryView ? ' kds-view-btn--active' : ''}`}
            onClick={() => setView('summary')} >
            Active Order Summary
          </button>
        </div>

        <div className="kds-header__right">
          {/* Pagination — only when multiple pages, in active/served grid views */}
          {!isSummaryView && !isServedView && totalPages > 1 && (
            <div className="kds-pagination">
              <button className="kds-page-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
              <span className="kds-page-info">{safePage}/{totalPages}</span>
              <button className="kds-page-btn" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>›</button>
            </div>
          )}
          <SocketStatus socket={socket} />
          <button className="kds-header-btn kds-header-btn--report" onClick={openReport}>Report</button>
          <button className="kds-icon-btn" onClick={openSettings} style={{ fontSize: 18, alignItems: 'center' }} >⚙</button>
          <Clock />
        </div>
      </div>

      {/* ── Error banner ──────────────────────────────────── */}
      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '6px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>⚠ {error}</span>
          <button onClick={loadKOTs} style={{ marginLeft: 'auto', background: '#991b1b', border: 'none', color: '#fff', padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}>Retry</button>
        </div>
      )}

      {/* ── Active Order Summary ──────────────────────────── */}
      {isSummaryView ? (
        <KDSSummary />
      ) : (
        /* ── Orders grid ───────────────────────────────────── */
        <div className={`kds-grid kds-grid--${grid}`}>
          {isLoading ? (
            <div className="kds-empty">Loading…</div>
          ) : isEmpty ? (
            <div className="kds-empty">
              <div className="kds-empty__icon">✓</div>
              <div className="kds-empty__text">{isServedView ? 'No served orders yet' : 'ALL CLEAR'}</div>
              {!isServedView && <div className="kds-empty__sub">No active orders</div>}
            </div>
          ) : (
            cards.map(order => <KOTCard key={order.id} kot={order} showServed={isServedView} />)
          )}
        </div>
      )}

      {settingsOpen && <KDSSettings onClose={closeSettings} />}
      {reportOpen && <KDSReport onClose={closeReport} />}
    </div>
  );
}
