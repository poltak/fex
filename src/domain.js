import Decimal from 'decimal.js-light';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });

const separatorCache = new Map();
const integerFormatCache = new Map();
const minorUnitCache = new Map();

/** @typedef {Record<string, {rate:string, date:string}>} Rates */
/** @param {string} locale */
function separators(locale) {
  if (separatorCache.has(locale)) return separatorCache.get(locale);
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const result = { decimal: parts.find(p => p.type === 'decimal')?.value || '.', group: parts.find(p => p.type === 'group')?.value || ',' };
  separatorCache.set(locale, result);
  return result;
}

/** @param {{text:string,locale?:string,enforceLimits?:boolean}} options
 * @returns {{status:'valid'|'empty'|'incomplete'|'invalid',value?:string,message?:string}} */
export function parseAmount({ text, locale = 'en-US', enforceLimits = true }) {
  const raw = text.trim();
  if (!raw) return { status: 'empty' };
  const invalid = (message = 'Enter a number with valid decimal and grouping separators.') => ({ status: /** @type {'invalid'} */ ('invalid'), message });
  if (raw.includes('-')) return invalid('Enter zero or a positive amount.');
  if (!/^[0-9.,\s\u00a0\u202f]+$/.test(raw)) return invalid();
  const { decimal, group } = separators(locale);
  let decimalChar = decimal;
  // A point is an alternate decimal only if it cannot be a valid local group.
  if (decimal !== '.' && !raw.includes(decimal) && raw.includes('.')) {
    const grouped = /^\d{1,3}(?:\.\d{3})+$/.test(raw);
    if (group !== '.' || !grouped) decimalChar = '.';
  }
  const pieces = raw.split(decimalChar);
  if (pieces.length > 2) return invalid();
  const whole = pieces[0];
  const fraction = pieces[1];
  const groupChar = group === decimalChar ? '' : group;
  const groupTokens = [...whole].filter(c => !/[0-9]/.test(c));
  if (groupTokens.some(c => c !== groupChar && !/[ \u00a0\u202f]/.test(c))) return invalid();
  if (groupTokens.length) {
    const normalized = whole.replace(/[\u00a0\u202f]/g, ' ');
    const used = [...new Set([...normalized].filter(c => !/[0-9]/.test(c)))];
    if (used.length !== 1 || !/^\d{1,3}(?:[^0-9]\d{3})+$/.test(normalized)) return invalid();
  }
  if (fraction !== undefined && !/^\d*$/.test(fraction)) return invalid();
  const digits = whole.replace(/[^0-9]/g, '');
  if (!digits && fraction === undefined) return invalid();
  if (enforceLimits && (digits.length > 15 || (fraction?.length || 0) > 12)) return invalid('Use at most 15 whole-number digits and 12 decimal digits.');
  if (fraction === '') return { status: 'incomplete' };
  return { status: 'valid', value: new Decimal(`${digits || '0'}${fraction !== undefined ? `.${fraction}` : ''}`).toFixed() };
}

/** @param {Rates} rates @param {string} code */
function rate(rates, code) {
  if (code === 'USD') return new Decimal(1);
  try { const value = new Decimal(rates[code]?.rate); return value.gt(0) ? value : null; } catch { return null; }
}

/** @param {{rates:Rates}} options */
export function createConverter({ rates }) {
  const memo = new Map();
  const get = code => { if (!memo.has(code)) memo.set(code, rate(rates, code)); return memo.get(code); };
  /** @param {{amount:string,source:string,target:string}} options */
  return ({ amount, source, target }) => {
    try {
      const value = new Decimal(amount);
      const from = get(source), to = get(target);
      if (value.lt(0) || !from || !to) return null;
      return source === target ? value.toFixed() : value.times(to).div(from).toFixed();
    } catch { return null; }
  };
}

/** @param {{amount:string,source:string,target:string,rates:Rates}} options */
export function convertAmount({ amount, source, target, rates }) { return createConverter({ rates })({ amount, source, target }); }

/** @param {string} value @param {string} locale @param {boolean} [grouped] */
function localize(value, locale, grouped = true) {
  const [whole, fraction] = value.split('.');
  const key = `${locale}:${grouped}`;
  if (!integerFormatCache.has(key)) integerFormatCache.set(key, new Intl.NumberFormat(locale, { useGrouping: grouped, maximumFractionDigits: 0 }));
  const integer = integerFormatCache.get(key).format(BigInt(whole));
  return integer + (fraction === undefined ? '' : separators(locale).decimal + fraction);
}

/** @param {{amount:string,currency:string,locale?:string}} options */
export function formatAmount({ amount, currency, locale = 'en-US' }) {
  try {
    if (!minorUnitCache.has(currency)) minorUnitCache.set(currency, new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits);
    const digits = minorUnitCache.get(currency);
    const value = new Decimal(amount);
    const unit = new Decimal(10).pow(-digits);
    if (!value.isZero() && value.abs().lt(unit)) return `<${localize(unit.toFixed(digits), locale)}`;
    return localize(value.toFixed(digits), locale);
  } catch { return '—'; }
}

/** @param {{amount:string,locale?:string}} options */
export function formatEditable({ amount, locale = 'en-US' }) {
  try { return localize(new Decimal(amount).toFixed(), locale, false); } catch { return ''; }
}

/** @param {{source:string,target:string,rates:Rates,locale?:string}} options */
export function formatUnitRate({ source, target, rates, locale = 'en-US' }) {
  const value = convertAmount({ amount: '1', source, target, rates });
  if (value === null) return 'Rate unavailable';
  return `1 ${source} ≈ ${localize(new Decimal(value).toSignificantDigits(6).toFixed(), locale)} ${target}`;
}

/** @param {{source:string,codes:string[],rates:Rates}} options */
export function rateDates({ source, codes, rates }) {
  const dates = [...new Set([source, ...codes].filter(code => code !== 'USD').map(code => rates[code]?.date).filter(Boolean))].sort();
  return { dates, oldest: dates[0] || null, newest: dates.at(-1) || null };
}

/** @param {{date:string,now?:number}} options */
export function isOldRate({ date, now = Date.now() }) {
  const stamp = Date.parse(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date && Math.floor(now / 86400000) - Math.floor(stamp / 86400000) > 7;
}

/** @param {string} text */
export function normalizeSearch(text) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim(); }
