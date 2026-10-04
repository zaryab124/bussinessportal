/**
 * Helper to convert array of objects into RFC 4180 compliant CSV string
 * @param {Array<{ key: string, label: string }>} columns
 * @param {Array<Object>} rows
 * @returns {string} CSV string
 */
function toCsv(columns, rows) {
  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(c => escapeCell(c.label)).join(',');
  const lines = rows.map(row => {
    return columns.map(c => escapeCell(row[c.key])).join(',');
  });

  return [header, ...lines].join('\r\n');
}

module.exports = { toCsv };
