const TZ = 'Asia/Kathmandu';

/** Parse a MySQL timestamp string (no tz suffix, Nepal local) to a Date */
function toUTC(dateString) {
  if (!dateString) return null;
  // Epoch ms number
  if (typeof dateString === 'number') return new Date(dateString);
  const s = String(dateString);
  // Already has tz info
  if (s.endsWith('Z') || s.includes('+') || /T.*-\d{2}:\d{2}$/.test(s)) return new Date(s);
  // MySQL DATETIME: '2025-01-15 10:30:00' — stored in Nepal local time
  return new Date(s.replace(' ', 'T') + '+05:45');
}

export function formatNepalTime(dateString) {
  const d = toUTC(dateString);
  if (!d || isNaN(d)) return '';
  return d.toLocaleTimeString('en-NP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatNepalTime24(dateString) {
  const d = toUTC(dateString);
  if (!d || isNaN(d)) return '';
  return d.toLocaleTimeString('en-NP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatNepalDate(dateString) {
  const d = toUTC(dateString);
  if (!d || isNaN(d)) return '';
  return d.toLocaleDateString('en-NP', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatNepalDateTime(dateString) {
  const d = toUTC(dateString);
  if (!d || isNaN(d)) return '';
  return d.toLocaleString('en-NP', {
    timeZone: TZ,
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/** Parse a UTC timestamp string to ms since epoch, treating SQLite strings as UTC */
export function toUtcMs(dateString) {
  const d = toUTC(dateString);
  return d ? d.getTime() : 0;
}

/** Start of today in Nepal time, as a UTC Date */
export function getNepalTodayStart() {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // 'YYYY-MM-DD'
  return new Date(date + 'T00:00:00+05:45');
}

/** End of today in Nepal time, as a UTC Date */
export function getNepalTodayEnd() {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(date + 'T23:59:59.999+05:45');
}

/** Current Nepal date as 'YYYY-MM-DD' */
export function getNepalDateStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Format Nepal local time for the live clock display */
export function nepalNow() {
  return new Date().toLocaleTimeString('en-NP', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

export function nepalNowFull() {
  return new Date().toLocaleString('en-NP', {
    timeZone: TZ,
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}
