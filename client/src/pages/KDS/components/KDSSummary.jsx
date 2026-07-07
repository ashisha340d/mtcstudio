import { useKDS } from '../../../context/KDSContext';

// Active Order Summary — aggregated unserved items for the active station.
//   Qty | Item Name | Tables
export default function KDSSummary() {
  const { activeSummary } = useKDS();

  if (!activeSummary || activeSummary.length === 0) {
    return (
      <div className="kds-empty">
        <div className="kds-empty__icon">✓</div>
        <div className="kds-empty__text">ALL CLEAR</div>
        <div className="kds-empty__sub">No pending items</div>
      </div>
    );
  }

  const totalQty = activeSummary.reduce((sum, r) => sum + r.qty, 0);

  return (
    <div className="kds-summary">
      <table className="kds-summary__table">
        <thead>
          <tr>
            <th className="kds-summary__th-qty">Qty</th>
            <th>Item Name</th>
            <th>Tables</th>
          </tr>
        </thead>
        <tbody>
          {activeSummary.map(row => (
            <tr key={row.name}>
              <td className="kds-summary__qty">{row.qty}</td>
              <td className="kds-summary__name">{row.name}</td>
              <td className="kds-summary__tables">{row.tables.join(', ')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="kds-summary__qty">{totalQty}</td>
            <td className="kds-summary__total-lbl" colSpan={2}>
              Total items pending
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
