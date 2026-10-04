import { CLOCK_TOLERANCE, CODE, validateCatalog, validateSnapshot } from './data.js';
import { HISTORY_PERIODS, validateHistoryRecord } from './history.js';

/** @typedef {{codes:string[],source:string,amount:string,draft?:string}} Preferences */
/** @typedef {{items:import('./data.js').Currency[],checkedAt:number}} CatalogRecord */
/** @typedef {import('./history.js').HistoryRecord} HistoryRecord */

const PREFS = 'fex:preferences:v1';
const CHART_SETTINGS = 'fex:chart-settings:v1';
const DB = 'fex-cache';
const STORAGE_TIMEOUT_MS = 1000;
const HISTORY_PREFIX = 'history:v1:';
const HISTORY_MAX_RECORDS = 12;
const HISTORY_MAX_BYTES = 2 * 1024 * 1024;

// A stalled browser database must not block startup or hold a refresh in flight.
function transactionResult({ transaction, result }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Saved storage timed out.'));
      try { transaction.abort(); } catch { /* The transaction may already be closed. */ }
    }, STORAGE_TIMEOUT_MS);
    transaction.oncomplete = () => { clearTimeout(timer); resolve(result()); };
    const failed = () => { clearTimeout(timer); reject(transaction.error || new Error('Saved storage transaction stopped.')); };
    transaction.onerror = failed;
    transaction.onabort = failed;
  });
}

function preferences(input) {
  const codes = input?.codes;
  const validCodes = Array.isArray(codes) && codes.length > 0 && codes.length <= 512
    && codes.every(code => typeof code === 'string' && CODE.test(code))
    && new Set(codes).size === codes.length && codes.includes(input.source);
  const amount = input?.amount;
  const validAmount = typeof amount === 'string' && amount.length <= 128 && amount.split('.')[0].length <= 30
    && (amount === '' || /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount));
  if (!validCodes || !validAmount) throw new Error('Saved preferences are invalid.');
  if (input.draft !== undefined && (typeof input.draft !== 'string' || input.draft.length > 128)) throw new Error('Saved draft is invalid.');
  return { codes: [...codes], source: input.source, amount, ...(input.draft !== undefined ? { draft: input.draft } : {}) };
}

function catalog(record) {
  if (!record || !Number.isFinite(record.checkedAt) || record.checkedAt < 0) throw new Error('Saved currency list is invalid.');
  return { items: validateCatalog(record.items), checkedAt: record.checkedAt };
}

function chartSettings(input) {
  if (!input || typeof input.base !== 'string' || !CODE.test(input.base)
    || typeof input.quote !== 'string' || !CODE.test(input.quote) || input.base === input.quote
    || !HISTORY_PERIODS.includes(input.period)) throw new Error('Saved chart settings are invalid.');
  return { base: input.base, quote: input.quote, period: input.period };
}

// Each saved value has a version wrapper so that a later format can migrate it.
function unwrap({ record, validate }) {
  if (record?.version !== 1) throw new Error('Saved data has an unsupported version.');
  return validate(record.value);
}

// A saved record is better than an incoming one with an earlier check time.
// A time in the future does not count, because it means the device clock went back.
function savedIsNewer({ saved, incoming }) {
  return saved.checkedAt > incoming.checkedAt && saved.checkedAt <= Date.now() + CLOCK_TOLERANCE;
}

function historyKey(record) {
  return `${HISTORY_PREFIX}${record.base}:${record.quote}:${record.from}:${record.to}`;
}

function serializedSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Browser storage is optional. Memory remains usable if a browser blocks it. */
export function createStorage({
  onError = (_error) => {}, indexedDB: idb = undefined, localStorage: local = undefined,
  BroadcastChannel: Channel = globalThis.BroadcastChannel, IDBKeyRange: KeyRange = globalThis.IDBKeyRange,
  eventTarget = globalThis.window,
} = {}) {
  const memory = new Map();
  const listeners = new Set();
  let closed = false, database = null, opening = null, channel = null;
  const report = error => onError(error instanceof Error ? error : new Error(String(error)));
  try { if (idb === undefined) idb = globalThis.indexedDB; } catch (error) { report(error); }
  try { local ??= globalThis.localStorage; } catch (error) { report(error); }
  try { if (Channel) channel = new Channel('fex:cache:v1'); } catch (error) { report(error); }
  const emit = value => { if (!closed) for (const listener of listeners) listener(value); };
  if (channel) channel.onmessage = event => { if (event.data?.type === 'rates') emit({ type: 'rates' }); };

  // Preferences and chart settings are small. They use localStorage, which other tabs can observe.
  function readLocal({ key, validate }) {
    try {
      const raw = local?.getItem(key);
      if (raw) memory.set(key, unwrap({ record: JSON.parse(raw), validate }));
    } catch (error) { report(error); }
    return memory.get(key) ?? null;
  }
  function writeLocal({ key, input, validate }) {
    try {
      const value = validate(input);
      memory.set(key, value);
      if (!local) throw new Error('Saved preferences storage is unavailable.');
      local.setItem(key, JSON.stringify({ version: 1, value }));
      return true;
    } catch (error) { report(error); return false; }
  }
  const onStorage = event => {
    if (event.key !== PREFS || !event.newValue) return;
    try {
      const value = unwrap({ record: JSON.parse(event.newValue), validate: preferences });
      memory.set(PREFS, value);
      emit({ type: 'preferences', value });
    } catch (error) { report(error); }
  };
  eventTarget?.addEventListener('storage', onStorage);

  function open() {
    if (closed) return Promise.reject(new Error('Storage is closed.'));
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!idb) { reject(new Error('Saved storage is unavailable.')); return; }
      let abandoned = false;
      const fail = error => { abandoned = true; clearTimeout(timer); reject(error); };
      const timer = setTimeout(() => fail(new Error('Saved storage timed out.')), STORAGE_TIMEOUT_MS);
      let request;
      try { request = idb.open(DB, 1); } catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        if (abandoned || closed) { request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains('cache')) request.result.createObjectStore('cache');
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (abandoned || closed) { request.result.close(); reject(new Error('Storage is closed.')); return; }
        database = request.result;
        database.onversionchange = () => { database.close(); database = null; opening = null; };
        resolve(database);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('Saved storage is blocked by another tab.'));
    });
    return opening;
  }

  async function read({ key, validate }) {
    try {
      const db = await open();
      const transaction = db.transaction('cache', 'readonly');
      const request = transaction.objectStore('cache').get(key);
      const record = await transactionResult({ transaction, result: () => request.result });
      if (record != null) memory.set(key, unwrap({ record, validate }));
    } catch (error) { report(error); }
    return memory.get(key) ?? null;
  }

  async function write({ key, input, validate }) {
    let value;
    try { value = validate(input); } catch (error) { report(error); return false; }
    memory.set(key, value);
    try {
      const db = await open();
      // Compare and write in one transaction so a late tab cannot replace newer data.
      const transaction = db.transaction('cache', 'readwrite');
      const store = transaction.objectStore('cache');
      const existing = store.get(key);
      let accepted = false;
      existing.onsuccess = () => {
        let saved = null;
        try { saved = unwrap({ record: existing.result, validate }); } catch { /* Replace a corrupt or missing record. */ }
        const olderDate = code => saved.rates[code] && value.rates[code].date < saved.rates[code].date;
        if (saved && (savedIsNewer({ saved, incoming: value }) || (key === 'rates' && Object.keys(value.rates).some(olderDate)))) {
          memory.set(key, saved);
          return;
        }
        store.put({ version: 1, value }, key);
        accepted = true;
      };
      const saved = await transactionResult({ transaction, result: () => accepted });
      if (saved && key === 'rates') channel?.postMessage({ type: 'rates' });
      return saved;
    } catch (error) { report(error); return false; }
  }

  // The history cache holds a small number of validated series and drops the least recently used one first.
  // The map is the copy for this session. IndexedDB keeps the series between visits.
  /** @type {Map<string,{record:HistoryRecord,size:number}>} */
  const history = new Map();
  let historyLoaded = null;

  function pruneHistory() {
    const removed = [];
    const oldestFirst = [...history].sort((a, b) => a[1].record.lastUsedAt - b[1].record.lastUsedAt);
    let bytes = oldestFirst.reduce((sum, [, entry]) => sum + entry.size, 0);
    for (const [key, entry] of oldestFirst) {
      if (history.size <= HISTORY_MAX_RECORDS && bytes <= HISTORY_MAX_BYTES) break;
      history.delete(key);
      bytes -= entry.size;
      removed.push(key);
    }
    return removed;
  }

  // Read the saved series once. Writes wait for this, so the map starts empty here.
  function loadHistory() {
    historyLoaded ??= (async () => {
      try {
        const db = await open();
        const transaction = db.transaction('cache', 'readwrite');
        const store = transaction.objectStore('cache');
        const range = KeyRange.bound(HISTORY_PREFIX, `${HISTORY_PREFIX}￿`);
        const keys = store.getAllKeys(range);
        const values = store.getAll(range);
        values.onsuccess = () => {
          keys.result.forEach((key, index) => {
            try {
              const record = unwrap({ record: values.result[index], validate: validateHistoryRecord });
              if (historyKey(record) !== key) throw new Error('Saved history has the wrong key.');
              history.set(key, { record, size: serializedSize(record) });
            } catch { store.delete(key); /* A corrupt cache entry has no value. */ }
          });
          // Another tab can save more than the limit. Remove the excess.
          for (const key of pruneHistory()) store.delete(key);
        };
        await transactionResult({ transaction, result: () => true });
      } catch (error) { report(error); }
    })();
    return historyLoaded;
  }

  /** @returns {Promise<HistoryRecord[]>} Saved series. Do not change them. */
  async function readHistoryRecords() {
    await loadHistory();
    return [...history.values()].map(entry => entry.record);
  }

  async function writeHistory(input) {
    let record;
    try { record = validateHistoryRecord(input); } catch (error) { report(error); return false; }
    const size = serializedSize(record);
    if (size > HISTORY_MAX_BYTES) return false;
    await loadHistory();
    const key = historyKey(record);
    const current = history.get(key)?.record;
    if (current && savedIsNewer({ saved: current, incoming: record })) return false;
    if (current?.checkedAt === record.checkedAt) record.lastUsedAt = Math.max(current.lastUsedAt, record.lastUsedAt);
    history.set(key, { record, size });
    const removed = pruneHistory();
    const kept = history.has(key);
    try {
      const db = await open();
      const transaction = db.transaction('cache', 'readwrite');
      const store = transaction.objectStore('cache');
      if (kept) store.put({ version: 1, value: record }, key);
      for (const old of removed) store.delete(old);
      return await transactionResult({ transaction, result: () => kept });
    } catch (error) { report(error); return false; }
  }

  return {
    /** @returns {Preferences|null} */
    readPreferences: () => readLocal({ key: PREFS, validate: preferences }),
    writePreferences: input => writeLocal({ key: PREFS, input, validate: preferences }),
    readChartSettings: () => readLocal({ key: CHART_SETTINGS, validate: chartSettings }),
    writeChartSettings: input => writeLocal({ key: CHART_SETTINGS, input, validate: chartSettings }),
    readRates: () => read({ key: 'rates', validate: validateSnapshot }),
    writeRates: input => write({ key: 'rates', input, validate: validateSnapshot }),
    readCatalog: () => read({ key: 'catalog', validate: catalog }),
    writeCatalog: input => write({ key: 'catalog', input, validate: catalog }),
    readHistoryRecords,
    writeHistory,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    close() { closed = true; database?.close(); channel?.close(); eventTarget?.removeEventListener('storage', onStorage); listeners.clear(); },
  };
}
