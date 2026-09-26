import { validateCatalog, validateSnapshot } from './data.js';
/** @typedef {{codes:string[],source:string,amount:string,draft?:string}} Preferences */
/** @typedef {{items:import('./data.js').Currency[],checkedAt:number}} CatalogRecord */
const PREFS = 'fex:preferences:v1';
const DB = 'fex-cache';
function preferences(input) {
  if (!input || !Array.isArray(input.codes) || !input.codes.length || input.codes.length > 512 || input.codes.some(code => typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) || new Set(input.codes).size !== input.codes.length || !input.codes.includes(input.source) || typeof input.amount !== 'string' || input.amount.length > 128 || input.amount.split('.')[0].length > 30 || (input.amount !== '' && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.amount))) throw new Error('Saved preferences are invalid.');
  if (input.draft !== undefined && (typeof input.draft !== 'string' || input.draft.length > 128)) throw new Error('Saved draft is invalid.');
  return { codes: [...input.codes], source: input.source, amount: input.amount, ...(input.draft !== undefined ? { draft: input.draft } : {}) };
}
function catalog(record) {
  if (!record || !Number.isFinite(record.checkedAt) || record.checkedAt < 0) throw new Error('Saved currency list is invalid.');
  return { items: validateCatalog(record.items), checkedAt: record.checkedAt };
}
/** Browser storage is optional. Memory remains usable if a browser blocks it. */
export function createStorage({ onError = (_error) => {}, indexedDB: idb = globalThis.indexedDB, localStorage: local = undefined, BroadcastChannel: Channel = globalThis.BroadcastChannel, eventTarget = globalThis.window } = {}) {
  const memory = new Map();
  const listeners = new Set();
  let closed = false, database = null, opening = null, channel = null;
  const report = error => onError(error instanceof Error ? error : new Error(String(error)));
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
      let blocked = false;
      const request = idb.open(DB, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('cache')) request.result.createObjectStore('cache'); };
      request.onsuccess = () => { if (blocked || closed) { request.result.close(); reject(new Error('Storage is closed.')); return; } database = request.result; database.onversionchange = () => { database.close(); database = null; opening = null; }; resolve(database); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(new Error('Saved storage is blocked by another tab.')); };
    });
    return opening;
  }
  async function access({ key, value = undefined, write = false }) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', write ? 'readwrite' : 'readonly');
      const request = write ? tx.objectStore('cache').put(value, key) : tx.objectStore('cache').get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Saved storage transaction stopped.'));
    });
  }
  async function read(key, validate) {
    try {
      const record = await access({ key });
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
      const saved = await new Promise((resolve, reject) => {
        const tx = db.transaction('cache', 'readwrite');
        const store = tx.objectStore('cache');
        const existing = store.get(key);
        let accepted = false;
        existing.onsuccess = () => {
          let previous = null;
          try { if (existing.result?.version === 1) previous = validate(existing.result.value); } catch { /* Replace corrupt records. */ }
          if (previous && previous.checkedAt > value.checkedAt && previous.checkedAt <= Date.now() + 300000) { memory.set(key, previous); return; }
          if (key === 'rates' && previous && Object.keys(value.rates).some(code => previous.rates[code] && value.rates[code].date < previous.rates[code].date)) { memory.set(key, previous); return; }
          store.put({ version: 1, value }, key); accepted = true;
        };
        tx.oncomplete = () => resolve(accepted);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Saved storage transaction stopped.'));
      });
      if (saved && key === 'rates') channel?.postMessage({ type: 'rates' });
      return saved;
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
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    close() { closed = true; database?.close(); channel?.close(); eventTarget?.removeEventListener('storage', onStorage); listeners.clear(); },
  };
}
