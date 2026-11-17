/* Bikram Sambat (BS) ↔ Gregorian (AD) for the dashboard clock strip.
   The month-length table below was generated from `nepali-date-converter`
   and covers BS 2070–2090 (AD 2013-04-14 → 2034-04-12). Outside that span the
   helpers return null and callers simply fall back to the AD date. */

const ANCHOR_BS_YEAR = 2070;
const ANCHOR_AD = Date.UTC(2013, 3, 14);   // BS 2070-01-01

const BS_MONTH_DAYS = {
  2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2085: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2086: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
};

export const BS_MONTHS_EN = [
  'Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];
export const BS_MONTHS_NP = [
  'वैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
  'कात्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत',
];
export const BS_WEEKDAYS_NP = ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];

const NP_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
export const toNpDigits = (n) => String(n).replace(/\d/g, d => NP_DIGITS[Number(d)]);

const MS_DAY = 86400000;

/** 'YYYY-MM-DD' or Date → UTC midnight ms, so DST can never shift the count. */
function utcOf(input) {
  if (input instanceof Date) return Date.UTC(input.getFullYear(), input.getMonth(), input.getDate());
  const [y, m, d] = String(input).slice(0, 10).split('-').map(Number);
  return Number.isFinite(y) ? Date.UTC(y, m - 1, d) : NaN;
}

/**
 * AD → BS. Returns null when the date falls outside the table.
 * @returns {{ year:number, month:number, day:number, weekday:number }|null} month is 0-based
 */
export function toBS(input) {
  const ms = utcOf(input);
  if (!Number.isFinite(ms)) return null;
  let offset = Math.round((ms - ANCHOR_AD) / MS_DAY);
  if (offset < 0) return null;

  let year = ANCHOR_BS_YEAR;
  let month = 0;
  while (true) {
    const lengths = BS_MONTH_DAYS[year];
    if (!lengths) return null;
    const len = lengths[month];
    if (offset < len) break;
    offset -= len;
    if (++month > 11) { month = 0; year++; }
  }
  return { year, month, day: offset + 1, weekday: new Date(ms).getUTCDay() };
}

/** 'साउन ११, २०८३' */
export const formatNp = (bs) =>
  bs ? `${BS_MONTHS_NP[bs.month]} ${toNpDigits(bs.day)}, ${toNpDigits(bs.year)}` : '';

/** 'Shrawan 11, 2083' */
export const formatEn = (bs) =>
  bs ? `${BS_MONTHS_EN[bs.month]} ${bs.day}, ${bs.year}` : '';

/** Today in Nepal as 'YYYY-MM-DD' — the app's canonical business date. */
export const todayNepalAD = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
