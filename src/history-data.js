import { CODE, HOUR, isFresh, request, retryDelay } from './data.js';
import { getHistoryRange, HISTORY_PERIODS, validateHistoryRecord, validateHistoryRows } from './history.js';

// A saved interval from an earlier day can be a few days shorter or longer than today's interval.
const PERIOD_TOLERANCE_DAYS = { '1W': 1, '1M': 4, '3M': 5, '1Y': 4, '5Y': 5 };

/** @typedef {import('./history.js').HistoryRecord} HistoryRecord */
/** @typedef {{phase:'idle'|'loading'|'ready'|'offline'|'error',record:HistoryRecord|null,error:string|null,retryAt:number|null,refreshing:boolean}} HistoryState */

/** @param {{base:string,quote:string,from:string,to:string,fetchImpl?:typeof fetch,signal?:AbortSignal,now?:()=>number}} options */
export async function fetchHistory({ base, quote, from, to, fetchImpl = fetch, signal, now = Date.now }) {
  // Check the request before the network call. An empty row list has only the request to check.
  validateHistoryRows({ rows: [], base, quote, from, to });
  const query = new URLSearchParams({ base, quotes: quote, from, to });
  const rows = await request({ url: `https://api.frankfurter.dev/v2/rates?${query}`, fetchImpl, signal });
  const checkedAt = now();
  return { base, quote, from, to, points: validateHistoryRows({ rows, base, quote, from, to }), checkedAt, lastUsedAt: checkedAt };
}

function days({ from, to }) {
  return (Date.parse(to) - Date.parse(from)) / 86400000;
}

// The part of a saved record that is in the wanted range.
function view({ record, from, to }) {
  const start = record.from > from ? record.from : from;
  const end = record.to < to ? record.to : to;
  return { ...record, from: start, to: end, points: record.points.filter(point => point.date >= start && point.date <= end) };
}

/** Find the best saved series for a range. Full coverage is best. If there is none,
 * the interval from an earlier day is a preview while the new interval loads. */
function findSaved({ records, base, quote, from, to, period, now }) {
  const samePair = records.filter(record => record.base === base && record.quote === quote);
  const fresh = record => Number(isFresh({ checkedAt: record.checkedAt, maxAge: HOUR, now }));
  const covering = samePair.filter(record => record.from <= from && record.to >= to);
  if (covering.length) {
    covering.sort((a, b) => fresh(b) - fresh(a) || b.checkedAt - a.checkedAt || days(a) - days(b));
    return { source: covering[0], record: view({ record: covering[0], from, to }), full: true };
  }
  const wanted = days({ from, to });
  const tolerance = PERIOD_TOLERANCE_DAYS[period];
  const overlap = record => days({ from: record.from > from ? record.from : from, to: record.to < to ? record.to : to });
  const earlier = samePair.filter(record => record.to < to
    && Math.abs(days(record) - wanted) <= tolerance
    && overlap(record) >= wanted - tolerance);
  if (!earlier.length) return null;
  earlier.sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : b.checkedAt - a.checkedAt));
  return { source: earlier[0], record: view({ record: earlier[0], from, to }), full: false };
}

/** Load one pair and period at a time. A new selection cancels the previous request.
 * @param {{storage:{readHistoryRecords:()=>Promise<HistoryRecord[]>,writeHistory:(record:HistoryRecord)=>Promise<boolean>},onChange:(state:HistoryState)=>void,fetchHistory?:typeof fetchHistory,now?:()=>number}} options */
export function createHistoryController({ storage, onChange, fetchHistory: loader = fetchHistory, now = Date.now }) {
  /** @type {HistoryState} */ let state = { phase: 'idle', record: null, error: null, retryAt: null, refreshing: false };
  let active = null, generation = 0, failures = 0, retryAt = null, serverCooldown = false;
  // The range that `state` describes. A repeated load of this range keeps the visible series.
  let shownKey = null;

  const publish = patch => {
    state = { ...state, ...patch };
    onChange(state);
    return state;
  };

  const cancelActive = () => {
    generation += 1;
    active?.controller.abort();
    active = null;
    return generation;
  };

  function load({ base, quote, period, online = true, force = false }) {
    if (!CODE.test(base) || !CODE.test(quote) || base === quote || !HISTORY_PERIODS.includes(period)) return Promise.reject(new Error('The history selection is invalid.'));
    const { from, to } = getHistoryRange({ period, now: now() });
    const key = `${base}:${quote}:${from}:${to}`;
    if (active?.key === key && active.online === online) return active.promise;
    const shown = key === shownKey ? state.record : null;
    const settled = state.phase === 'ready' && !state.refreshing;
    // The visible series is complete and recent. There is nothing to do.
    if (shown && settled && online && !force && isFresh({ checkedAt: shown.checkedAt, maxAge: HOUR, now: now() })) return Promise.resolve(state);
    const id = cancelActive();
    const controller = new AbortController();
    shownKey = key;
    if (!shown) publish({ phase: 'loading', record: null, error: null, retryAt, refreshing: false });

    const work = (async () => {
      let records = [];
      try { records = await storage.readHistoryRecords(); } catch { /* A network request can still succeed. */ }
      if (id !== generation) return state;
      const saved = findSaved({ records, base, quote, from, to, period, now: now() });
      const record = saved?.record ?? null;
      if (saved) {
        // Count this use for the cache's least-recently-used order. One write an hour is enough.
        if (now() - saved.source.lastUsedAt >= HOUR) void storage.writeHistory({ ...saved.source, lastUsedAt: now() });
        const fresh = saved.full && isFresh({ checkedAt: record.checkedAt, maxAge: HOUR, now: now() });
        if (!online) return publish({ phase: 'offline', record, error: null, retryAt, refreshing: false });
        if (fresh && !force) return publish({ phase: 'ready', record, error: null, retryAt, refreshing: false });
        publish({ phase: 'ready', record, error: null, retryAt, refreshing: true });
      } else if (!online) {
        return publish({ phase: 'offline', record: null, error: null, retryAt, refreshing: false });
      }

      if (retryAt !== null && now() < retryAt && (serverCooldown || !force)) {
        const error = serverCooldown ? 'The history service asked us to wait before trying again.' : 'History could not be updated yet.';
        return publish({ phase: 'error', record, error, retryAt, refreshing: false });
      }

      let fetched;
      try {
        fetched = validateHistoryRecord(await loader({ base, quote, from, to, signal: controller.signal, now }));
        if (fetched.base !== base || fetched.quote !== quote || fetched.from !== from || fetched.to !== to) throw new Error('The history service returned a different range.');
      } catch (error) {
        if (id !== generation || controller.signal.aborted || error?.name === 'AbortError') return state;
        if (error?.status !== 404) {
          serverCooldown = error?.status === 429;
          retryAt = now() + retryDelay({ error, failures: serverCooldown ? failures : failures++ });
          return publish({ phase: 'error', record, error: error?.message || 'History could not be loaded.', retryAt, refreshing: false });
        }
        // The service has no data for this pair. Save that result as an empty series.
        const checkedAt = now();
        fetched = { base, quote, from, to, points: [], checkedAt, lastUsedAt: checkedAt };
      }
      if (id !== generation) return state;
      failures = 0; serverCooldown = false; retryAt = null;
      publish({ phase: 'ready', record: fetched, error: null, retryAt, refreshing: false });
      try { await storage.writeHistory(fetched); } catch { /* The series stays on the screen for this view. */ }
      return state;
    })();
    const promise = work.finally(() => { if (active?.id === id) active = null; });
    active = { id, key, controller, promise, online };
    return promise;
  }

  return {
    load,
    deactivate() {
      cancelActive();
      shownKey = null;
      publish({ phase: 'idle', record: null, error: null, retryAt, refreshing: false });
    },
    getState: () => state,
  };
}
