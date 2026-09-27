import { isFresh, request } from './data.js';
import { getHistoryRange, HISTORY_PERIODS, validateHistoryRecord, validateHistoryRows } from './history.js';

const HOUR = 3600000;
const CODE = /^[A-Z]{3}$/;
const RETRY_DELAYS = [60000, 300000, 900000, HOUR];
const PERIOD_TOLERANCE_DAYS = { '1W': 1, '1M': 4, '3M': 5, '1Y': 4, '5Y': 5 };

/** @typedef {import('./history.js').HistoryRecord} HistoryRecord */

/** @param {{base:string,quote:string,from:string,to:string,fetchImpl?:typeof fetch,signal?:AbortSignal,now?:()=>number}} options */
export async function fetchHistory({ base, quote, from, to, fetchImpl = fetch, signal, now = Date.now }) {
  if (!CODE.test(base) || !CODE.test(quote) || base === quote) throw new Error('The history currency pair is invalid.');
  validateHistoryRows({ rows: [], base, quote, from, to });
  const query = new URLSearchParams({ base, quotes: quote, from, to });
  const rows = await request({ url: `https://api.frankfurter.dev/v2/rates?${query}`, fetchImpl, signal });
  const points = validateHistoryRows({ rows, base, quote, from, to });
  const checkedAt = now();
  return validateHistoryRecord({ base, quote, from, to, points, checkedAt, lastUsedAt: checkedAt });
}

function rangeDays({ from, to }) {
  return (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86400000;
}

function covers({ record, from, to }) {
  return record.from <= from && record.to >= to;
}

function exactCachedView({ record, from, to, now }) {
  return validateHistoryRecord({
    ...record,
    from,
    to,
    points: record.points.filter(point => point.date >= from && point.date <= to),
    lastUsedAt: now,
  });
}

function previousIntervalView({ record, from, to, now }) {
  const actualFrom = record.from > from ? record.from : from;
  const actualTo = record.to < to ? record.to : to;
  if (actualFrom > actualTo) return null;
  return validateHistoryRecord({
    ...record,
    from: actualFrom,
    to: actualTo,
    points: record.points.filter(point => point.date >= actualFrom && point.date <= actualTo),
    lastUsedAt: now,
  });
}

function matchingRecord({ records, base, quote, from, to, period, now }) {
  const samePair = records.filter(record => record.base === base && record.quote === quote);
  const covering = samePair.filter(record => covers({ record, from, to }));
  if (covering.length) {
    covering.sort((a, b) => Number(isFresh({ checkedAt: b.checkedAt, maxAge: HOUR, now })) - Number(isFresh({ checkedAt: a.checkedAt, maxAge: HOUR, now }))
      || b.checkedAt - a.checkedAt
      || rangeDays({ from: a.from, to: a.to }) - rangeDays({ from: b.from, to: b.to }));
    return { record: covering[0], full: true };
  }
  const wantedDays = rangeDays({ from, to });
  const tolerance = PERIOD_TOLERANCE_DAYS[period];
  const previous = samePair.filter(record => record.to < to
    && Math.abs(rangeDays({ from: record.from, to: record.to }) - wantedDays) <= tolerance
    && rangeDays({ from: record.from > from ? record.from : from, to: record.to < to ? record.to : to }) >= wantedDays - tolerance);
  previous.sort((a, b) => b.to.localeCompare(a.to) || b.checkedAt - a.checkedAt);
  return previous.length ? { record: previous[0], full: false } : null;
}

function abortError(error, signal) {
  return signal.aborted || error?.name === 'AbortError' || error?.name === 'CanceledError';
}

/** @param {{storage:{readHistoryRecords:()=>Promise<HistoryRecord[]>,writeHistory:(record:HistoryRecord)=>Promise<boolean>},onChange:(state:HistoryState)=>void,fetchHistory?:typeof fetchHistory,now?:()=>number}} options */
export function createHistoryController({ storage, onChange, fetchHistory: loader = fetchHistory, now = Date.now }) {
  /** @type {HistoryState} */ let state = { phase: 'idle', record: null, error: null, retryAt: null, refreshing: false };
  let active = null, generation = 0, destroyed = false, failures = 0, retryAt = null, serverCooldown = false;

  const publish = patch => {
    state = { ...state, ...patch };
    if (!destroyed) onChange({ ...state, record: state.record ? { ...state.record, points: state.record.points.map(point => ({ ...point })) } : null });
    return state;
  };

  const cancelActive = () => {
    generation += 1;
    active?.controller.abort();
    active = null;
    return generation;
  };

  function load({ base, quote, period, online = true, force = false }) {
    if (destroyed) return Promise.resolve({ ...state });
    if (!CODE.test(base) || !CODE.test(quote) || base === quote || !HISTORY_PERIODS.includes(period)) return Promise.reject(new Error('The history selection is invalid.'));
    const { from, to } = getHistoryRange({ period, now: now() });
    const key = `${base}:${quote}:${from}:${to}`;
    if (active?.key === key && (online || !active.online)) return active.promise;
    const id = cancelActive();
    const controller = new AbortController();
    publish({ phase: 'loading', record: null, error: null, retryAt, refreshing: false });

    const work = (async () => {
      let saved = [];
      try { saved = await storage.readHistoryRecords(); } catch { /* A network request can still succeed. */ }
      if (destroyed || id !== generation) return { ...state };
      const validSaved = [];
      for (const item of saved || []) {
        try { validSaved.push(validateHistoryRecord(item)); } catch { /* Ignore corrupt cache entries. */ }
      }
      const match = matchingRecord({ records: validSaved, base, quote, from, to, period, now: now() });
      const candidate = match?.full ? exactCachedView({ record: match.record, from, to, now: now() })
        : match ? previousIntervalView({ record: match.record, from, to, now: now() }) : null;
      if (candidate) {
        // Update LRU use time without changing the check time.
        void storage.writeHistory({ ...match.record, lastUsedAt: now() }).catch(() => false);
        const fresh = match.full && isFresh({ checkedAt: candidate.checkedAt, maxAge: HOUR, now: now() });
        if (!online) return publish({ phase: 'offline', record: candidate, error: null, retryAt, refreshing: false });
        if (fresh && !force) return publish({ phase: 'ready', record: candidate, error: null, retryAt, refreshing: false });
        publish({ phase: 'ready', record: candidate, error: null, retryAt, refreshing: true });
      } else if (!online) {
        return publish({ phase: 'offline', record: null, error: null, retryAt, refreshing: false });
      }

      if (retryAt !== null && now() < retryAt && (serverCooldown || !force)) {
        const message = serverCooldown ? 'The history service asked us to wait before trying again.' : 'History could not be updated yet.';
        return publish({ phase: 'error', record: candidate, error: message, retryAt, refreshing: false });
      }

      try {
        const record = validateHistoryRecord(await loader({ base, quote, from, to, signal: controller.signal, now }));
        if (destroyed || id !== generation) return { ...state };
        if (record.base !== base || record.quote !== quote || record.from !== from || record.to !== to) throw new Error('The history service returned a different range.');
        const updated = { ...record, lastUsedAt: now() };
        failures = 0;
        serverCooldown = false;
        retryAt = null;
        publish({ phase: 'ready', record: updated, error: null, retryAt: null, refreshing: false });
        try { await storage.writeHistory(updated); } catch { /* Keep the fetched series available in memory for this view. */ }
        return { ...state };
      } catch (error) {
        if (destroyed || id !== generation || abortError(error, controller.signal)) return { ...state };
        if (error?.status === 404) {
          const checkedAt = now();
          const empty = validateHistoryRecord({ base, quote, from, to, points: [], checkedAt, lastUsedAt: checkedAt });
          publish({ phase: 'ready', record: empty, error: null, retryAt, refreshing: false });
          try { await storage.writeHistory(empty); } catch { /* Keep the empty result for this view. */ }
          return { ...state };
        }
        const delay = error?.status === 429 ? error.retryAfterMs ?? 900000 : RETRY_DELAYS[Math.min(failures++, RETRY_DELAYS.length - 1)];
        serverCooldown = error?.status === 429;
        retryAt = now() + delay;
        return publish({ phase: 'error', record: candidate, error: error?.message || 'History could not be loaded.', retryAt, refreshing: false });
      }
    })();
    const promise = work.finally(() => { if (active?.id === id) active = null; });
    active = { id, key, controller, promise, online };
    return promise;
  }

  return {
    load,
    deactivate() {
      if (destroyed) return;
      cancelActive();
      publish({ phase: 'idle', record: null, error: null, retryAt, refreshing: false });
    },
    getState() { return { ...state, record: state.record ? { ...state.record, points: state.record.points.map(point => ({ ...point })) } : null }; },
    destroy() {
      if (destroyed) return;
      cancelActive();
      destroyed = true;
    },
  };
}

/** @typedef {{phase:'idle'|'loading'|'ready'|'offline'|'error',record:HistoryRecord|null,error:string|null,retryAt:number|null,refreshing:boolean}} HistoryState */
