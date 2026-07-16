import { useEffect, useMemo, useState, useCallback } from 'react';
import { checkFonepay } from '../../../lib/fonepayBridge';

// Fixed display order for well-known fields; anything else the DOM scrape
// returns (Fonepay adding a column, etc.) is appended after these, in the
// order it first appears — grid stays correct without a code change.
const FIELD_PRIORITY = ['transactionId', 'amount', 'date', 'time', 'payer', 'status', 'reference'];
const FIELD_LABELS = {
  transactionId: 'Transaction ID', amount: 'Amount', date: 'Date', time: 'Time',
  payer: 'Payer', status: 'Status', reference: 'Reference No.',
};

function humanizeKey(key) {
  return FIELD_LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}

function deriveColumns(rows) {
  const seen = new Set();
  const cols = [];
  for (const key of FIELD_PRIORITY) {
    if (rows.some(r => key in r)) { cols.push(key); seen.add(key); }
  }
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); cols.push(key); }
    }
  }
  return cols;
}

/** Read-only "Check Fonepay" popup — latest 3 payments, no matching/processing. */
export default function FonepayPanel({ onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    setSelected(null);
    checkFonepay()
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message || 'Fonepay check failed.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { run(); }, [run]);

  const columns = useMemo(() => deriveColumns(rows), [rows]);

  function copyTxnId(row, idx) {
    const txnId = row.transactionId || row.reference || '';
    if (!txnId) return;
    navigator.clipboard?.writeText(txnId).then(() => {
      setCopiedId(idx);
      setTimeout(() => setCopiedId((c) => (c === idx ? null : c)), 1200);
    });
  }

  return (
    <div className="fonepay-panel" data-testid="fonepay-panel">
      <div className="fonepay-panel__title">
        <span>💳 Fonepay — Latest 3 Payments</span>
        <button onClick={onClose} aria-label="Close" data-testid="fonepay-close">✕</button>
      </div>

      <div className="fonepay-panel__toolbar">
        <button onClick={run} disabled={loading} data-testid="fonepay-refresh">
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {loading && (
        <div className="fonepay-panel__state">Fetching latest payments from Fonepay…</div>
      )}

      {!loading && error && (
        <div className="fonepay-panel__state fonepay-panel__state--error">⚠ {error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="fonepay-panel__state">No payments found.</div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="fonepay-panel__grid-wrap">
          <table className="fonepay-panel__grid">
            <thead>
              <tr>
                {columns.map((c) => <th key={c}>{humanizeKey(c)}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.transactionId || idx}
                  className={selected === idx ? 'fonepay-panel__row--selected' : ''}
                  onClick={() => setSelected(idx)}
                  data-testid={`fonepay-row-${idx}`}
                >
                  {columns.map((c) => <td key={c}>{row[c] ?? ''}</td>)}
                  <td>
                    <button
                      className="fonepay-panel__copy-btn"
                      onClick={(e) => { e.stopPropagation(); copyTxnId(row, idx); }}
                      title="Copy Transaction ID"
                    >
                      {copiedId === idx ? '✓' : '⧉'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
