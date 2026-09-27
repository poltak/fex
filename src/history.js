import Decimal from 'decimal.js-light';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

/** @typedef {{date:string,rate:string}} HistoryPoint */
/** @typedef {{base:string,quote:string,from:string,to:string,points:HistoryPoint[],checkedAt:number,lastUsedAt:number}} HistoryRecord */

export const HISTORY_PERIODS = Object.freeze(['1W', '1M', '3M', '1Y', '5Y']);
const CODE = /^[A-Z]{3}$/;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validRate(value) {
  return (typeof value === 'string' || typeof value === 'number')
    && /^(?:\d+(?:\.\d+)?)(?:e[+-]?\d+)?$/i.test(String(value))
    && Number.isFinite(Number(value))
    && Number(value) > 0;
}

function sameRate({ left, right }) {
  try { return new Decimal(left).eq(new Decimal(right)); } catch { return false; }
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function subtractMonths({ date, months }) {
  const targetIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() - months;
  const year = Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/** @param {{period:string,now?:number}} options */
export function getHistoryRange({ period, now = Date.now() }) {
  if (!HISTORY_PERIODS.includes(period)) throw new Error('The history period is invalid.');
  if (!Number.isFinite(now)) throw new Error('The history date is invalid.');
  const toDate = new Date(now);
  if (!Number.isFinite(toDate.getTime())) throw new Error('The history date is invalid.');
  let fromDate;
  if (period === '1W') {
    fromDate = new Date(toDate);
    fromDate.setUTCDate(fromDate.getUTCDate() - 7);
  } else if (period === '1M' || period === '3M') {
    fromDate = subtractMonths({ date: toDate, months: period === '1M' ? 1 : 3 });
  } else if (period === '1Y') {
    fromDate = subtractMonths({ date: toDate, months: 12 });
  } else {
    fromDate = subtractMonths({ date: toDate, months: 60 });
  }
  return { from: dateString(fromDate), to: dateString(toDate) };
}

/** @param {{rows:unknown,base:string,quote:string,from:string,to:string}} options @returns {HistoryPoint[]} */
export function validateHistoryRows({ rows, base, quote, from, to }) {
  if (!CODE.test(base) || !CODE.test(quote) || base === quote || !validDate(from) || !validDate(to) || from > to) throw new Error('The history request is invalid.');
  if (!Array.isArray(rows)) throw new Error('The history response is invalid.');
  const points = new Map();
  for (const row of rows) {
    if (!row || row.base !== base || row.quote !== quote || !validDate(row.date) || row.date < from || row.date > to || !validRate(row.rate)) throw new Error('The history response contains an invalid row.');
    const point = { date: row.date, rate: String(row.rate) };
    const previous = points.get(point.date);
    if (previous && !sameRate({ left: previous.rate, right: point.rate })) throw new Error('The history response contains conflicting dates.');
    if (!previous) points.set(point.date, point);
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** @param {unknown} input @returns {HistoryRecord} */
export function validateHistoryRecord(input) {
  if (!input || typeof input !== 'object') throw new Error('Saved history is invalid.');
  const record = /** @type {Partial<HistoryRecord>} */ (input);
  if (!CODE.test(record.base || '') || !CODE.test(record.quote || '') || record.base === record.quote
    || !validDate(record.from || '') || !validDate(record.to || '') || record.from > record.to
    || !Array.isArray(record.points) || !Number.isFinite(record.checkedAt) || record.checkedAt < 0
    || !Number.isFinite(record.lastUsedAt) || record.lastUsedAt < 0) throw new Error('Saved history is invalid.');
  const points = new Map();
  for (const point of record.points) {
    if (!point || !validDate(point.date) || point.date < record.from || point.date > record.to || !validRate(point.rate)) throw new Error('Saved history contains an invalid point.');
    const normalized = { date: point.date, rate: String(point.rate) };
    const previous = points.get(normalized.date);
    if (previous && !sameRate({ left: previous.rate, right: normalized.rate })) throw new Error('Saved history contains conflicting dates.');
    if (!previous) points.set(normalized.date, normalized);
  }
  return {
    base: record.base,
    quote: record.quote,
    from: record.from,
    to: record.to,
    points: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)),
    checkedAt: record.checkedAt,
    lastUsedAt: record.lastUsedAt,
  };
}

/** @param {{points:HistoryPoint[],from:string,to:string}} options @returns {HistoryPoint[]} */
export function sliceHistoryPoints({ points, from, to }) {
  if (!validDate(from) || !validDate(to) || from > to || !Array.isArray(points)) return [];
  return points.filter(point => point.date >= from && point.date <= to).map(point => ({ ...point }));
}

/** @param {{points:HistoryPoint[]}} options @returns {{value:string,direction:'up'|'down'|'unchanged'}|null} */
export function getHistoryChange({ points }) {
  if (!Array.isArray(points) || points.length < 2) return null;
  try {
    if (!validRate(points[0].rate) || !validRate(points.at(-1).rate)) return null;
    const first = new Decimal(points[0].rate);
    const last = new Decimal(points.at(-1).rate);
    if (!first.gt(0) || !last.gt(0)) return null;
    const change = last.minus(first).div(first).times(100);
    const direction = change.gt(0) ? 'up' : change.lt(0) ? 'down' : 'unchanged';
    const value = change.isZero() ? '0' : `${change.gt(0) ? '+' : ''}${change.toSignificantDigits(8).toFixed()}`;
    return { value, direction };
  } catch { return null; }
}

/** @param {{rate:string|number,locale?:string}} options */
export function formatHistoryRate({ rate, locale = 'en-US' }) {
  if (!validRate(rate)) return '—';
  try { return new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 }).format(Number(rate)); } catch { return '—'; }
}

/** @param {{date:string,locale?:string,options?:Intl.DateTimeFormatOptions}} options */
export function formatHistoryDate({ date, locale = 'en-US', options = { year: 'numeric', month: 'short', day: 'numeric' } }) {
  if (!validDate(date)) return '—';
  try { return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00.000Z`)); } catch { return date; }
}
