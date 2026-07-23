// Generic column-config table. A report adds a field by pushing one entry to
// its columns array — { key, label, align, width, render, total, csv }.
export default function ReportTable({ columns, rows, totals, onRowClick, emptyMessage = 'No data for the selected period' }) {
  if (!rows || !rows.length) {
    return (
      <div className="rp-empty">
        <div className="rp-empty-icon">▤</div>
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="rp-table-wrap">
      <table className="rp-table">
        <colgroup>
          {columns.map(col => <col key={col.key} style={col.width ? { width: col.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} className={`rp-al-${col.align || 'left'}`}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            /* id can repeat across orphan rows — pair it with the index so React
               never reuses a row node for different data. */
            <tr
              key={`${row.id ?? 'r'}#${i}`}
              className={onRowClick ? 'rp-row--clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map(col => (
                <td key={col.key} className={`rp-al-${col.align || 'left'}${col.emphasis ? ' rp-cell--strong' : ''}`}>
                  {col.render ? col.render(row, i) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {columns.map(col => (
                <td key={col.key} className={`rp-al-${col.align || 'left'}`}>
                  {col.total ? col.total(totals) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
