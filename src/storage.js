import { validateCatalog, validateSnapshot } from './data.js';
import { HISTORY_PERIODS, validateHistoryRecord } from './history.js';
/** @typedef {{codes:string[],source:string,amount:string,draft?:string}} Preferences */
/** @typedef {{items:import('./data.js').Currency[],checkedAt:number}} CatalogRecord */
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
  if (!input || !Array.isArray(input.codes) || !input.codes.length || input.codes.length > 512 || input.codes.some(code => typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) || new Set(input.codes).size !== input.codes.length || !input.codes.includes(input.source) || typeof input.amount !== 'string' || input.amount.length > 128 || input.amount.split('.')[0].length > 30 || (input.amount !== '' && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.amount))) throw new Error('Saved preferences are invalid.');
  if (input.draft !== undefined && (typeof input.draft !== 'string' || input.draft.length > 128)) throw new Error('Saved draft is invalid.');
  return { codes: [...input.codes], source: input.source, amount: input.amount, ...(input.draft !== undefined ? { draft: input.draft } : {}) };
}
function catalog(record) {
  if (!record || !Number.isFinite(record.checkedAt) || record.checkedAt < 0) throw new Error('Saved currency list is invalid.');
  return { items: validateCatalog(record.items), checkedAt: record.checkedAt };
}
function chartSettings(input) {
  if (!input || typeof input.base !== 'string' || !/^[A-Z]{3}$/.test(input.base)
    || typeof input.quote !== 'string' || !/^[A-Z]{3}$/.test(input.quote) || input.base === input.quote
    || !HISTORY_PERIODS.includes(input.period)) throw new Error('Saved chart settings are invalid.');
  return { base: input.base, quote: input.quote, period: input.period };
}
function historyKey(record) {
  return `${HISTORY_PREFIX}${record.base}:${record.quote}:${record.from}:${record.to}`;
}
function serializedSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function pruneHistoryMap(records) {
  const sorted = [...records.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  let bytes = sorted.reduce((sum, [, record]) => sum + serializedSize(record), 0);
  while (records.size > HISTORY_MAX_RECORDS || bytes > HISTORY_MAX_BYTES) {
    const [key, record] = sorted.shift();
    if (!key) break;
    records.delete(key);
    bytes -= serializedSize(record);
  }
}
function mergeHistoryMemory({ records, incoming }) {
  const key = historyKey(incoming);
  const current = records.get(key);
  let chosen = incoming;
  if (current && current.checkedAt > incoming.checkedAt && current.checkedAt <= Date.now() + 300000) chosen = current;
  else if (current && current.checkedAt === incoming.checkedAt) chosen = { ...current, lastUsedAt: Math.max(current.lastUsedAt, incoming.lastUsedAt) };
  records.set(key, chosen);
  return chosen;
}
/** Browser storage is optional. Memory remains usable if a browser blocks it. */
export function createStorage({ onError = (_error) => {}, indexedDB: idb = undefined, localStorage: local = undefined, BroadcastChannel: Channel = globalThis.BroadcastChannel, eventTarget = globalThis.window } = {}) {
  const memory = new Map();
  const historyMemory = new Map();
  let chartSettingsMemory = null;
  const listeners = new Set();
  let closed = false, database = null, opening = null, channel = null;
  const report = error => onError(error instanceof Error ? error : new Error(String(error)));
  try { if (idb === undefined) idb = globalThis.indexedDB; } catch (error) { report(error); }
  try { local ??= globalThis.localStorage; } catch (error) { report(error); }
  try { if (Channel) channel = new Channel('fex:cache:v1'); } catch (error) { report(error); }
  const emit = value => { if (!closed) for (const listener of listeners) listener(value); };
  if (channel) channel.onmessage = event => { if (event.data?.type === 'rates') emit({ type: 'rates' }); };
  const onStorage = event => {
    if (event.key !== PREFS || !event.newValue) return;
    try { const record = JSON.parse(event.newValue); if (record.version !== 1) throw new Error('Saved preferences have an unsupported version.'); const value = preferences(record.value); memory.set('preferences', value); emit({ type: 'preferences', value }); } catch (error) { report(error); }
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
  async function access(key) {
    const db = await open();
    const transaction = db.transaction('cache', 'readonly');
    const request = transaction.objectStore('cache').get(key);
    return transactionResult({ transaction, result: () => request.result });
  }
  async function accessAll() {
    const db = await open();
    const transaction = db.transaction('cache', 'readonly');
    const store = transaction.objectStore('cache');
    const keys = store.getAllKeys();
    const values = store.getAll();
    return transactionResult({ transaction, result: () => ({ keys: keys.result, values: values.result }) });
  }
  async function read(key, validate) {
    try {
      const record = await access(key);
      if (record != null) { if (record.version !== 1) throw new Error('Saved cache has an unsupported version.'); const value = validate(record.value); memory.set(key, value); return value; }
    } catch (error) { report(error); }
    return memory.get(key) ?? null;
  }
  async function write(key, input, validate) {
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
        let previous = null;
        try { if (existing.result?.version === 1) previous = validate(existing.result.value); } catch { /* Replace corrupt records. */ }
        if (previous && previous.checkedAt > value.checkedAt && previous.checkedAt <= Date.now() + 300000) { memory.set(key, previous); return; }
        if (key === 'rates' && previous && Object.keys(value.rates).some(code => previous.rates[code] && value.rates[code].date < previous.rates[code].date)) { memory.set(key, previous); return; }
        store.put({ version: 1, value }, key); accepted = true;
      };
      const saved = await transactionResult({ transaction, result: () => accepted });
      if (saved && key === 'rates') channel?.postMessage({ type: 'rates' });
      return saved;
    } catch (error) { report(error); return false; }
  }
  async function hydrateHistoryRecords() {
    try {
      const { keys, values } = await accessAll();
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== 'string' || !key.startsWith(HISTORY_PREFIX)) continue;
        try {
          const wrapper = values[index];
          if (wrapper?.version !== 1) throw new Error('Saved history has an unsupported version.');
          const record = validateHistoryRecord(wrapper.value);
          mergeHistoryMemory({ records: historyMemory, incoming: record });
        } catch (error) { report(error); }
      }
    } catch (error) { report(error); }
    pruneHistoryMap(historyMemory);
    return copyHistoryRecords();
  }
  function copyHistoryRecords() {
    return [...historyMemory.values()].map(record => ({ ...record, points: record.points.map(point => ({ ...point })) }));
  }
  function readHistoryRecords() {
    if (historyMemory.size) {
      void hydrateHistoryRecords();
      return Promise.resolve(copyHistoryRecords());
    }
    return hydrateHistoryRecords();
  }
  async function writeHistory(input) {
    let record;
    try { record = validateHistoryRecord(input); } catch (error) { report(error); return false; }
    const key = historyKey(record);
    if (serializedSize(record) > HISTORY_MAX_BYTES) return false;
    const current = historyMemory.get(key);
    if (current && current.checkedAt > record.checkedAt && current.checkedAt <= Date.now() + 300000) return false;
    if (current && current.checkedAt === record.checkedAt) record = { ...record, lastUsedAt: Math.max(current.lastUsedAt, record.lastUsedAt) };
    historyMemory.set(key, record);
    pruneHistoryMap(historyMemory);
    try {
      const db = await open();
      const transaction = db.transaction('cache', 'readwrite');
      const store = transaction.objectStore('cache');
      const existing = store.get(key);
      let accepted = false;
      existing.onsuccess = () => {
        let previous = null;
        try { if (existing.result?.version === 1) previous = validateHistoryRecord(existing.result.value); } catch { /* Replace corrupt history. */ }
        if (previous && previous.checkedAt > record.checkedAt && previous.checkedAt <= Date.now() + 300000) {
          mergeHistoryMemory({ records: historyMemory, incoming: previous });
          return;
        }
        store.put({ version: 1, value: record }, key);
        accepted = true;
        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();
        let keysReady = false, valuesReady = false;
        let keys = [], values = [];
        const malformedKeys = [];
        const prune = () => {
          if (!keysReady || !valuesReady) return;
          const records = [];
          for (let index = 0; index < keys.length; index += 1) {
            const savedKey = keys[index];
            if (typeof savedKey !== 'string' || !savedKey.startsWith(HISTORY_PREFIX)) continue;
            try {
              const wrapper = values[index];
              if (wrapper?.version !== 1) { malformedKeys.push(savedKey); continue; }
              const saved = validateHistoryRecord(wrapper.value);
              records.push({ key: savedKey, record: saved, size: serializedSize(saved) });
            } catch { malformedKeys.push(savedKey); }
          }
          for (const malformedKey of malformedKeys) { store.delete(malformedKey); historyMemory.delete(malformedKey); }
          records.sort((a, b) => a.record.lastUsedAt - b.record.lastUsedAt);
          let bytes = records.reduce((sum, item) => sum + item.size, 0);
          let count = records.length;
          for (const item of records) {
            if (count <= HISTORY_MAX_RECORDS && bytes <= HISTORY_MAX_BYTES) break;
            store.delete(item.key);
            historyMemory.delete(item.key);
            count -= 1;
            bytes -= item.size;
          }
          pruneHistoryMap(historyMemory);
        };
        keysRequest.onsuccess = () => { keys = keysRequest.result; keysReady = true; prune(); };
        valuesRequest.onsuccess = () => { values = valuesRequest.result; valuesReady = true; prune(); };
      };
      await transactionResult({ transaction, result: () => accepted });
      return accepted;
    } catch (error) { report(error); return false; }
  }
  return {
    readPreferences() {
      try { const raw = local?.getItem(PREFS); if (raw) { const record = JSON.parse(raw); if (record.version !== 1) throw new Error('Saved preferences have an unsupported version.'); const value = preferences(record.value); memory.set('preferences', value); return value; } } catch (error) { report(error); }
      return memory.get('preferences') ?? null;
    },
    writePreferences(input) {
      try { const value = preferences(input); memory.set('preferences', value); if (!local) throw new Error('Saved preferences storage is unavailable.'); local.setItem(PREFS, JSON.stringify({ version: 1, value })); return true; } catch (error) { report(error); return false; }
    },
    readRates: () => read('rates', validateSnapshot),
    writeRates: value => write('rates', value, validateSnapshot),
    readCatalog: () => read('catalog', catalog),
    writeCatalog: value => write('catalog', value, catalog),
    readHistoryRecords,
    writeHistory,
    readChartSettings() {
      try {
        const raw = local?.getItem(CHART_SETTINGS);
        if (raw) {
          const wrapper = JSON.parse(raw);
          if (wrapper.version !== 1) throw new Error('Saved chart settings have an unsupported version.');
          chartSettingsMemory = chartSettings(wrapper.value);
          return { ...chartSettingsMemory };
        }
      } catch (error) { report(error); }
      return chartSettingsMemory ? { ...chartSettingsMemory } : null;
    },
    writeChartSettings(input) {
      try {
        chartSettingsMemory = chartSettings(input);
        if (!local) throw new Error('Saved chart settings storage is unavailable.');
        local.setItem(CHART_SETTINGS, JSON.stringify({ version: 1, value: chartSettingsMemory }));
        return true;
      } catch (error) { report(error); return false; }
    },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    close() { closed = true; database?.close(); channel?.close(); eventTarget?.removeEventListener('storage', onStorage); listeners.clear(); },
  };
}
