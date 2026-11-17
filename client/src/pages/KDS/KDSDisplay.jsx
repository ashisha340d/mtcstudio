import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useKDS } from '../../context/KDSContext';
import KOTCard from './components/KOTCard';
import KDSSummary from './components/KDSSummary';
import KDSSettings from './components/KDSSettings';
import KDSReport from './components/KDSReport';
import KDSConfetti from './components/KDSConfetti';
import SocketStatus from '../../components/SocketStatus';
import posApi from '../../services/posApi';
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
  const fromAdmin = useLocation().state?.fromAdmin || sessionStorage.getItem('kds_from_admin') === '1';
  if (fromAdmin) sessionStorage.setItem('kds_from_admin', '1');
  const navigate = useNavigate();
  const {
    visibleKOTs, servedSearched, settings,
    activeTab, totalPages, safePage,
    filterStatus, loading, servedLoading,
    activeCount, servedCount,
    activeStationName, socket,
    settingsOpen, reportOpen, error,
    loadKOTs, loadServedKOTs,
    setTab, setPage, setFilter,
    openSettings, closeSettings,
    openReport, closeReport,
    formatMinSec,
  } = useKDS();

  useEffect(() => { loadKOTs(); }, []); // eslint-disable-line
  useEffect(() => {
    if (activeTab === 'served') loadServedKOTs();
  }, [activeTab]); // eslint-disable-line

  // ── Celebrate when this department's active orders hit zero ──
  const prevActiveCountRef = useRef(null);
  const [celebrate, setCelebrate] = useState(false);
  const [popperStats, setPopperStats] = useState(null); // { kotCount, avgSecs }
  useEffect(() => {
    const prev = prevActiveCountRef.current;
    prevActiveCountRef.current = activeCount;
    if (prev !== null && prev > 0 && activeCount === 0) {
      setCelebrate(true);
      posApi.getKDSReport(settings.activeDepartment)
        .then(r => setPopperStats({ kotCount: r.kot_count, avgSecs: r.avg_ticket_secs }))
        .catch(() => setPopperStats(null));
      const t = setTimeout(() => setCelebrate(false), 3400);
      return () => clearTimeout(t);
    }
  }, [activeCount]); // eslint-disable-line

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
          {fromAdmin && <button className="kds-header-btn" onClick={() => { sessionStorage.removeItem('kds_from_admin'); navigate(-1); }} title="Back to Studio">✕ Close</button>}
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
            <div className={`kds-empty${!isServedView && celebrate ? ' kds-empty--celebrate' : ''}`}>
              <div className="kds-empty__icon">✓</div>
              <div className="kds-empty__text">
                {isServedView ? 'No served orders yet' : (celebrate ? '🎉 गोर्खे दामी!🎉' : 'ALL CLEAR')}
              </div>
              {!isServedView && !celebrate && <div className="kds-empty__sub">No active orders</div>}
              {!isServedView && celebrate && popperStats && (
                <div className="kds-empty__popper-stats">
                  <div className="kds-empty__sub">KOTs served — Average time</div>
                  <div className="kds-empty__popper-row"><span>KOT</span><span>{popperStats.kotCount}</span></div>
                  <div className="kds-empty__popper-row"><span>Time</span><span>{formatMinSec(popperStats.avgSecs)} min</span></div>
                </div>
              )}
            </div>
          ) : (
            cards.map(order => <KOTCard key={order.id} kot={order} showServed={isServedView} />)
          )}
        </div>
      )}

      {celebrate && <KDSConfetti />}
      {settingsOpen && <KDSSettings onClose={closeSettings} />}
      {reportOpen && <KDSReport onClose={closeReport} />}
    </div>
  );
}
