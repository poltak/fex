/** @typedef {{code:string,name:string,symbol:string}} Currency */
/** @typedef {{rate:string,date:string}} Rate */
/** @typedef {{base:'USD',rates:Record<string,Rate>,checkedAt:number}} Snapshot */
const CODE = /^[A-Z]{3}$/;
const HOUR = 3600000;
function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
function validRate(rate) {
  return (typeof rate === 'string' || typeof rate === 'number') && /^(?:\d+(?:\.\d+)?)(?:e[+-]?\d+)?$/i.test(String(rate)) && Number.isFinite(Number(rate)) && Number(rate) > 0;
}
/** Validate the complete API catalog before using any row. @returns {Currency[]} */
export function validateCatalog(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('The currency list is empty or invalid.');
  const map = new Map();
  for (const row of rows) {
    if (!row || !CODE.test(row.iso_code ?? row.code) || typeof row.name !== 'string' || !row.name.trim() || (row.symbol != null && typeof row.symbol !== 'string')) throw new Error('The currency list is invalid.');
    const item = { code: row.iso_code ?? row.code, name: row.name, symbol: row.symbol ?? '' };
    if (map.has(item.code) && JSON.stringify(map.get(item.code)) !== JSON.stringify(item)) throw new Error('The currency list contains conflicting entries.');
    map.set(item.code, item);
  }
  return [...map.values()];
}
/** @returns {Snapshot} */
export function validateSnapshot(input) {
  if (!input || input.base !== 'USD' || !Number.isFinite(input.checkedAt) || input.checkedAt < 0 || !input.rates || typeof input.rates !== 'object' || Array.isArray(input.rates)) throw new Error('Saved rates are invalid.');
  const rates = {};
  for (const [code, row] of Object.entries(input.rates)) {
    if (!CODE.test(code) || !row || !validRate(row.rate) || !validDate(row.date)) throw new Error('A rate or its date is invalid.');
    rates[code] = { rate: String(row.rate), date: row.date };
  }
  if (!rates.USD || Number(rates.USD.rate) !== 1 || Object.keys(rates).length < 2) throw new Error('The rate list is incomplete.');
  return { base: 'USD', rates, checkedAt: input.checkedAt };
}
async function request({ url, fetchImpl, signal }) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const value = response.headers?.get('Retry-After');
          const parsed = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : value ? Date.parse(value) - Date.now() : NaN;
          throw Object.assign(new Error(`Rate service returned HTTP ${response.status}.`), { status: response.status, retryAfterMs: Number.isFinite(parsed) ? Math.max(0, parsed) : null });
        }
        return response.json();
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('The request timed out.')); }, 10000); }),
    ]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
/** @returns {Promise<Currency[]>} */
export async function fetchCatalog({ fetchImpl = fetch, signal = undefined } = {}) {
  return validateCatalog(await request({ url: 'https://api.frankfurter.dev/v2/currencies', fetchImpl, signal }));
}
/** @returns {Promise<Snapshot>} */
export async function fetchRates({ fetchImpl = fetch, signal = undefined, now = Date.now } = {}) {
  const rows = await request({ url: 'https://api.frankfurter.dev/v2/rates?base=USD', fetchImpl, signal });
  if (!Array.isArray(rows) || !rows.length) throw new Error('The rate response is empty or invalid.');
  const rates = {};
  for (const row of rows) {
    if (!row || row.base !== 'USD' || !CODE.test(row.quote) || !validRate(row.rate) || !validDate(row.date)) throw new Error('The rate response is invalid.');
    const rate = { rate: String(row.rate), date: row.date };
    if (rates[row.quote] && (Number(rates[row.quote].rate) !== Number(rate.rate) || rates[row.quote].date !== rate.date)) throw new Error('The rate response has conflicting entries.');
    rates[row.quote] = rate;
  }
  const date = Object.values(rates).map(row => row.date).sort().at(-1);
  if (rates.USD && Number(rates.USD.rate) !== 1) throw new Error('The USD identity rate is invalid.');
  rates.USD = { rate: '1', date };
  return validateSnapshot({ base: 'USD', rates, checkedAt: now() });
}
/** Coordinate saved and network rates without replacing a draft. */
export function createRateController({ storage, onApply, onStatus = (_status) => {}, getSource, isEditing, fetchRates: loader = fetchRates, now = Date.now }) {
  /** @type {Snapshot|null} */ let displayed = null;
  /** @type {Snapshot|null} */ let latest = null;
  /** @type {Snapshot|null} */ let pending = null;
  let inflight = null, abort = null, destroyed = false, failures = 0, cooldown = false;
  let status = { phase: 'loading', checkedAt: null, error: null, retryAt: null, pending: false };
  const future = snapshot => snapshot && snapshot.checkedAt > now() + 300000;
  const emit = (patch = {}) => { status = { ...status, ...patch, checkedAt: displayed?.checkedAt ?? null, pending: !!pending }; if (!destroyed) onStatus({ ...status }); };
  const adopt = (snapshot, network = false) => {
    if (destroyed) return false;
    if (latest && snapshot.checkedAt <= latest.checkedAt && !(network && future(latest) && !future(snapshot))) { emit({ phase: displayed ? 'ready' : 'loading' }); return false; }
    if (latest && Object.entries(snapshot.rates).some(([code, row]) => latest.rates[code] && row.date < latest.rates[code].date)) { emit({ phase: 'error', error: 'The service returned older rate dates.' }); return false; }
    const missingSource = !snapshot.rates[getSource()];
    if (missingSource && displayed?.rates[getSource()]) { emit({ phase: 'error', error: 'The source currency has no current rate.' }); return false; }
    latest = snapshot;
    if (isEditing()) pending = snapshot;
    else { displayed = snapshot; pending = null; onApply(snapshot); }
    emit({ phase: missingSource ? 'error' : 'ready', error: missingSource ? 'The source currency has no current rate.' : null });
    return true;
  };
  const acceptSaved = snapshot => {
    try { if (snapshot) return adopt(validateSnapshot(snapshot)); } catch { /* Ignore corrupt saved data. */ }
    return false;
  };
  return {
    async restore() { try { acceptSaved(await storage.readRates()); } catch { /* Network can still recover. */ } },
    acceptSaved,
    refresh({ force = false, online = true, visible = true } = {}) {
      if (destroyed || !visible) return Promise.resolve();
      if (!online) { emit({ phase: 'offline', error: null }); return Promise.resolve(); }
      if (inflight) return inflight;
      if (status.retryAt && now() < status.retryAt && (cooldown || !force)) return Promise.resolve();
      if (!force && latest && !future(latest) && now() - latest.checkedAt < HOUR) { emit({ phase: 'ready' }); return Promise.resolve(); }
      abort = new AbortController();
      emit({ phase: displayed ? 'refreshing' : 'loading', error: null });
      inflight = (async () => {
        try {
          const snapshot = validateSnapshot(await Promise.resolve().then(() => loader({ signal: abort.signal, now })));
          if (destroyed) return;
          // A newer cross-tab record can supersede this request without failure.
          if (latest && snapshot.checkedAt <= latest.checkedAt && !(future(latest) && !future(snapshot))) { emit({ phase: displayed ? 'ready' : 'loading' }); return; }
          if (!adopt(snapshot, true)) throw new Error(status.error || 'The rate response could not be applied.');
          failures = 0; cooldown = false;
          emit({ retryAt: null });
          await storage.writeRates(snapshot);
        } catch (error) {
          if (destroyed) return;
          const delay = error.status === 429 ? error.retryAfterMs ?? 900000 : [60000, 300000, 900000, HOUR][Math.min(failures++, 3)];
          cooldown = error.status === 429;
          emit({ phase: 'error', error: error.message || 'Rates could not be updated.', retryAt: now() + delay });
        } finally { inflight = null; }
      })();
      return inflight;
    },
    flushPending() {
      if (!pending || isEditing() || destroyed) return;
      const missingSource = !pending.rates[getSource()];
      if (missingSource && displayed?.rates[getSource()]) { emit({ error: 'The source currency has no current rate.' }); return; }
      displayed = pending; pending = null; onApply(displayed);
      emit({ phase: missingSource ? 'error' : 'ready', error: missingSource ? 'The source currency has no current rate.' : null });
    },
    getStatus() { return { ...status }; },
    destroy() { destroyed = true; abort?.abort(); },
  };
}
