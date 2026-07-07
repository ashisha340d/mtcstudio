import { useState, useEffect } from 'react';
import { useKDS } from '../../../context/KDSContext';
import posApi from '../../../services/posApi';
import { getNepalDateStr } from '../../../utils/dateTime';

export default function KDSReport({ onClose }) {
  const { settings, stations } = useKDS();
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const stationId = settings.activeDepartment;

  useEffect(() => {
    setLoading(true);
    posApi.getKDSReport(stationId)
      .then(r => { setRows(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [stationId]);

  const stationName = stationId
    ? stations.find(s => s.id === stationId)?.name ?? 'Station'
    : 'All Stations';

  const today = new Date(getNepalDateStr() + 'T00:00:00+05:45').toLocaleDateString('en-NP', {
    timeZone: 'Asia/Kathmandu', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="kds-modal-overlay" onClick={onClose}>
      <div className="kds-report-panel" onClick={e => e.stopPropagation()}>
        <div className="kds-report__header">
          <div>
            <div className="kds-report__title">Daily Report</div>
            <div className="kds-report__sub">{stationName} · {today}</div>
          </div>
          <button className="kds-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="kds-report__body">
          {loading ? (
            <div className="kds-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="kds-empty">No served items today.</div>
          ) : (
            <table className="kds-report__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Total Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.product_name}>
                    <td className="kds-report__idx">{i + 1}</td>
                    <td className="kds-report__name">{row.product_name}</td>
                    <td className="kds-report__qty">{row.total_qty}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="kds-report__total-lbl">Total Items Served</td>
                  <td className="kds-report__total-val">{rows.reduce((s, r) => s + r.total_qty, 0)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
