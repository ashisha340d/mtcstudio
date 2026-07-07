'use strict';

const TZ = 'Asia/Kathmandu';

/** Current date in Nepal as 'YYYY-MM-DD' */
function getNepalDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Returns UTC ISO bounds for a Nepal calendar day.
 * @param {string} [dateStr] - 'YYYY-MM-DD' in Nepal time (defaults to today)
 * @returns {{ start: string, end: string }} ISO strings in UTC
 */
function getNepalDayBoundsUTC(dateStr) {
  const d = dateStr ?? getNepalDateStr();
  // MySQL DATETIME columns are written by CURRENT_TIMESTAMP with the server
  // session tz (Asia/Kathmandu), i.e. Nepal wall-clock time — so day bounds
  // must be Nepal wall-clock strings too, NOT converted to UTC.
  return { start: `${d} 00:00:00`, end: `${d} 23:59:59` };
}

module.exports = { getNepalDateStr, getNepalDayBoundsUTC };
