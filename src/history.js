import { CODE, validDate, validRate } from './data.js';
import { Decimal } from './domain.js';

/** @typedef {{date:string,rate:string}} HistoryPoint */
/** @typedef {{base:string,quote:string,from:string,to:string,points:HistoryPoint[],checkedAt:number,lastUsedAt:number}} HistoryRecord */

export const HISTORY_PERIODS = Object.freeze(['1W', '1M', '3M', '1Y', '5Y']);
const PERIOD_MONTHS = { '1M': 1, '3M': 3, '1Y': 12, '5Y': 60 };
const numberFormats = new Map();
const dateFormats = new Map();

function sameRate({ left, right }) {
  try { return new Decimal(left).eq(new Decimal(right)); } catch { return false; }
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

// Keep the day of the month, or use the last day when the target month is shorter.
function subtractMonths({ date, months }) {
  const targetIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() - months;
  const year = Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/** Inclusive UTC date bounds for a period that ends today.
 * @param {{period:string,now?:number}} options */
export function getHistoryRange({ period, now = Date.now() }) {
  if (!HISTORY_PERIODS.includes(period)) throw new Error('The history period is invalid.');
  const toDate = new Date(now);
  if (!Number.isFinite(toDate.getTime())) throw new Error('The history date is invalid.');
  const fromDate = period === '1W'
    ? new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() - 7))
    : subtractMonths({ date: toDate, months: PERIOD_MONTHS[period] });
  return { from: dateString(fromDate), to: dateString(toDate) };
}

// Sort the points by date. Keep one of each exact duplicate and refuse a conflict.
function collectPoints({ rows, from, to, subject }) {
  const points = new Map();
  for (const row of rows) {
    if (!row || !validDate(row.date) || row.date < from || row.date > to || !validRate(row.rate)) throw new Error(`${subject} contains an invalid point.`);
    const rate = String(row.rate);
    const previous = points.get(row.date);
    if (previous && !sameRate({ left: previous.rate, right: rate })) throw new Error(`${subject} contains conflicting dates.`);
    if (!previous) points.set(row.date, { date: row.date, rate });
  }
  return [...points.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** @param {{rows:unknown,base:string,quote:string,from:string,to:string}} options @returns {HistoryPoint[]} */
export function validateHistoryRows({ rows, base, quote, from, to }) {
  if (!CODE.test(base) || !CODE.test(quote) || base === quote || !validDate(from) || !validDate(to) || from > to) throw new Error('The history request is invalid.');
  if (!Array.isArray(rows)) throw new Error('The history response is invalid.');
  if (rows.some(row => !row || row.base !== base || row.quote !== quote)) throw new Error('The history response contains an invalid row.');
  return collectPoints({ rows, from, to, subject: 'The history response' });
}

/** @param {unknown} input @returns {HistoryRecord} */
export function validateHistoryRecord(input) {
  const record = /** @type {Partial<HistoryRecord>} */ (input);
  if (!record || typeof record !== 'object'
    || !CODE.test(record.base || '') || !CODE.test(record.quote || '') || record.base === record.quote
    || !validDate(record.from) || !validDate(record.to) || record.from > record.to
    || !Array.isArray(record.points) || !Number.isFinite(record.checkedAt) || record.checkedAt < 0
    || !Number.isFinite(record.lastUsedAt) || record.lastUsedAt < 0) throw new Error('Saved history is invalid.');
  return {
    base: record.base,
    quote: record.quote,
    from: record.from,
    to: record.to,
    points: collectPoints({ rows: record.points, from: record.from, to: record.to, subject: 'Saved history' }),
    checkedAt: record.checkedAt,
    lastUsedAt: record.lastUsedAt,
  };
}

/** Change from the first point to the last point, in percent.
 * @param {{points:HistoryPoint[]}} options @returns {{value:string,direction:'up'|'down'|'unchanged'}|null} */
export function getHistoryChange({ points }) {
  if (!Array.isArray(points) || points.length < 2) return null;
  try {
    if (!validRate(points[0].rate) || !validRate(points.at(-1).rate)) return null;
    const first = new Decimal(points[0].rate);
    const change = new Decimal(points.at(-1).rate).minus(first).div(first).times(100);
    const direction = change.gt(0) ? 'up' : change.lt(0) ? 'down' : 'unchanged';
    const value = change.isZero() ? '0' : `${change.gt(0) ? '+' : ''}${change.toSignificantDigits(8).toFixed()}`;
    return { value, direction };
  } catch { return null; }
}

/** @param {{rate:string|number,locale?:string}} options */
export function formatHistoryRate({ rate, locale = 'en-US' }) {
  if (!validRate(rate)) return '—';
  try {
    if (!numberFormats.has(locale)) numberFormats.set(locale, new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }));
    return numberFormats.get(locale).format(Number(rate));
  } catch { return '—'; }
}

/** @param {{date:string,locale?:string,options?:Intl.DateTimeFormatOptions}} options */
export function formatHistoryDate({ date, locale = 'en-US', options = { year: 'numeric', month: 'short', day: 'numeric' } }) {
  if (!validDate(date)) return '—';
  try {
    const key = `${locale}:${JSON.stringify(options)}`;
    if (!dateFormats.has(key)) dateFormats.set(key, new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }));
    return dateFormats.get(key).format(new Date(`${date}T12:00:00Z`));
  } catch { return date; }
}
