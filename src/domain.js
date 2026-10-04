import Decimal from 'decimal.js-light';

// One shared configuration. Other modules import Decimal from here.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });
export { Decimal };

const numberLocaleCache = new Map();
const integerFormatCache = new Map();
const minorUnitCache = new Map();

/** @typedef {Record<string, {rate:string, date:string}>} Rates */
/** @param {string} locale */
function numberLocale(locale) {
  if (numberLocaleCache.has(locale)) return numberLocaleCache.get(locale);
  const parts = new Intl.NumberFormat(locale).formatToParts(123456789.1);
  const integerGroups = parts.filter(part => part.type === 'integer').map(part => [...part.value].length);
  const digitFormat = new Intl.NumberFormat(locale, { useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, digit) => digitFormat.format(digit));
  const result = {
    decimal: parts.find(part => part.type === 'decimal')?.value || '.',
    group: parts.find(part => part.type === 'group')?.value || ',',
    primaryGroup: integerGroups.at(-1) || 3,
    secondaryGroup: integerGroups.at(-2) || 3,
    digits,
    asciiDigits: digits.join('') === '0123456789',
    toAscii: new Map(digits.map((digit, index) => [digit, String(index)])),
  };
  numberLocaleCache.set(locale, result);
  return result;
}

function validGroups({ text, separator, primaryGroup, secondaryGroup }) {
  const groups = text.split(separator);
  return groups.length > 1 && groups.every(group => /^\d+$/.test(group))
    && groups.at(-1).length === primaryGroup
    && groups[0].length <= secondaryGroup
    && groups.slice(1, -1).every(group => group.length === secondaryGroup);
}

/** @param {{text:string,locale?:string}} options
 * @returns {{status:'valid'|'empty'|'incomplete'|'invalid',value?:string,message?:string}} */
export function parseAmount({ text, locale = 'en-US' }) {
  const settings = numberLocale(locale);
  const trimmed = text.trim();
  const raw = settings.asciiDigits ? trimmed : [...trimmed].map(char => settings.toAscii.get(char) ?? char).join('');
  if (!raw) return { status: 'empty' };
  const invalid = (message = 'Enter a number with valid decimal and grouping separators.') => ({ status: /** @type {'invalid'} */ ('invalid'), message });
  if (raw.includes('-')) return invalid('Enter zero or a positive amount.');
  const { decimal, group } = settings;
  let decimalChar = decimal;
  // A point is an alternate decimal only if it cannot be a valid local group.
  if (decimal !== '.' && !raw.includes(decimal) && raw.includes('.')) {
    const grouped = validGroups({ text: raw, separator: '.', ...settings });
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
    if (used.length !== 1 || !validGroups({ text: normalized, separator: used[0], ...settings })) return invalid();
  }
  if (fraction !== undefined && !/^\d*$/.test(fraction)) return invalid();
  const digits = whole.replace(/[^0-9]/g, '');
  if (!digits && fraction === undefined) return invalid();
  if (digits.length > 15 || (fraction?.length || 0) > 12) return invalid('Use at most 15 whole-number digits and 12 decimal digits.');
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

/** @param {{value:string,locale:string,grouped?:boolean}} options */
function localize({ value, locale, grouped = true }) {
  const [whole, fraction] = value.split('.');
  const key = `${locale}:${grouped}`;
  if (!integerFormatCache.has(key)) integerFormatCache.set(key, new Intl.NumberFormat(locale, { useGrouping: grouped, maximumFractionDigits: 0 }));
  const integer = integerFormatCache.get(key).format(BigInt(whole));
  const settings = numberLocale(locale);
  const localizedFraction = settings.asciiDigits ? fraction : fraction?.replace(/\d/g, digit => settings.digits[Number(digit)]);
  return integer + (fraction === undefined ? '' : settings.decimal + localizedFraction);
}

/** @param {{amount:string,currency:string,locale?:string}} options */
export function formatAmount({ amount, currency, locale = 'en-US' }) {
  try {
    if (!minorUnitCache.has(currency)) minorUnitCache.set(currency, new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits);
    const digits = minorUnitCache.get(currency);
    const value = new Decimal(amount);
    const unit = new Decimal(10).pow(-digits);
    if (!value.isZero() && value.abs().lt(unit)) return `<${localize({ value: unit.toFixed(digits), locale })}`;
    return localize({ value: value.toFixed(digits), locale });
  } catch { return '—'; }
}

/** @param {{amount:string,locale?:string}} options */
export function formatEditable({ amount, locale = 'en-US' }) {
  try { return localize({ value: new Decimal(amount).toFixed(), locale, grouped: false }); } catch { return ''; }
}

/** @param {{source:string,target:string,convert:ReturnType<typeof createConverter>,locale?:string}} options */
export function formatUnitRate({ source, target, convert, locale = 'en-US' }) {
  const value = convert({ amount: '1', source, target });
  if (value === null) return 'Rate unavailable';
  return `1 ${source} ≈ ${localize({ value: new Decimal(value).toSignificantDigits(6).toFixed(), locale })} ${target}`;
}

/** @param {{checkedAt:number,now?:number}} options */
export function formatChecked({ checkedAt, now = Date.now() }) {
  const minutes = Math.max(0, Math.floor((now - checkedAt) / 60000));
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} min ago`;
  if (minutes < 1440) return `Checked ${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `Checked ${days} ${days === 1 ? 'day' : 'days'} ago`;
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
