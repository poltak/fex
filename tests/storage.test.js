import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createStorage } from '../src/storage.js';
const prefs = { codes: ['USD', 'EUR'], source: 'USD', amount: '10.25' };
const rates = { base: 'USD', checkedAt: 100, rates: { USD: { rate: '1', date: '2026-09-25' }, EUR: { rate: '0.9', date: '2026-09-25' } } };
function localStore() { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map }; }
function setup(options = {}) { return createStorage({ indexedDB: new IDBFactory(), localStorage: localStore(), BroadcastChannel: null, ...options }); }
afterEach(() => vi.useRealTimers());
describe('storage', () => {
  it('bounds a stalled open and closes a connection that arrives too late', async () => {
    vi.useFakeTimers();
    const request = {};
    const x = setup({ indexedDB: { open: () => request } });
    const read = x.readRates();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await read).toBeNull();
    request.result = { close: vi.fn() };
    request.onsuccess();
    expect(request.result.close).toHaveBeenCalledOnce();
    expect(await x.writeRates(rates)).toBe(false);
    expect(await x.readRates()).toEqual(rates);
    x.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['read', 'write'])('aborts a stalled %s transaction and retains memory data', async operation => {
    vi.useFakeTimers();
    const transaction = { objectStore: () => ({ get: () => ({}) }), abort: vi.fn() };
    const database = { transaction: () => transaction, close: vi.fn() };
    const x = setup({ indexedDB: { open() {
      const request = { result: database };
      Promise.resolve().then(() => request.onsuccess());
      return request;
    } } });
    const pending = operation === 'read' ? x.readRates() : x.writeRates(rates);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe(operation === 'read' ? null : false);
    expect(transaction.abort).toHaveBeenCalledOnce();
    x.close();
    if (operation === 'write') expect(await x.readRates()).toEqual(rates);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('round trips preferences, rates and catalog without mixing records', async () => {
    const x = setup(); const catalog = { items: [{ code: 'USD', name: 'Dollar', symbol: '$' }], checkedAt: 123 };
    expect(x.writePreferences(prefs)).toBe(true); expect(x.readPreferences()).toEqual(prefs);
    await x.writeRates(rates); await x.writeCatalog(catalog); expect(await x.readRates()).toEqual(rates); expect(await x.readCatalog()).toEqual(catalog); x.close();
  });
  it('restores rates in a new storage instance', async () => {
    const indexedDB = new IDBFactory(); const a = setup({ indexedDB }); await a.writeRates(rates); a.close();
    const b = setup({ indexedDB }); expect(await b.readRates()).toEqual(rates); b.close();
  });
  it('does not let a late tab replace a newer snapshot or newer dates', async () => {
    const indexedDB = new IDBFactory(); const a = setup({ indexedDB }); const b = setup({ indexedDB });
    await a.writeRates({ ...rates, checkedAt: 200 });
    expect(await b.writeRates(rates)).toBe(false); expect((await b.readRates()).checkedAt).toBe(200);
    expect(await b.writeRates({ ...rates, checkedAt: 300, rates: { ...rates.rates, EUR: { rate: '0.8', date: '2026-09-24' } } })).toBe(false);
    expect((await a.readRates()).rates.EUR.date).toBe('2026-09-25'); a.close(); b.close();
  });
  it('rejects corrupt and unknown-version preferences', () => {
    const localStorage = localStore(); const onError = vi.fn(); const x = setup({ localStorage, onError });
    localStorage.setItem('fex:preferences:v1', '{oops'); expect(x.readPreferences()).toBeNull();
    localStorage.setItem('fex:preferences:v1', JSON.stringify({ version: 2, value: prefs })); expect(x.readPreferences()).toBeNull(); expect(onError).toHaveBeenCalledTimes(2); x.close();
  });
  it('rejects malformed records without replacing good data', async () => {
    const x = setup(); await x.writeRates(rates); expect(await x.writeRates({ ...rates, base: 'EUR' })).toBe(false); expect(await x.readRates()).toEqual(rates);
    x.writePreferences(prefs); expect(x.writePreferences({ ...prefs, codes: ['USD', 'USD'] })).toBe(false); expect(x.readPreferences()).toEqual(prefs); x.close();
  });
  it('bounds corrupt preferences and preserves long derived decimals', () => {
    const x = setup();
    expect(x.writePreferences({ ...prefs, amount: '1'.repeat(31) })).toBe(false);
    expect(x.writePreferences({ ...prefs, amount: `0.${'1'.repeat(128)}` })).toBe(false);
    expect(x.writePreferences({ ...prefs, codes: Array(513).fill('USD') })).toBe(false);
    const derived = { ...prefs, amount: `1.${'2'.repeat(39)}` };
    expect(x.writePreferences(derived)).toBe(true); expect(x.readPreferences()).toEqual(derived); x.close();
  });
  it('preserves raw drafts and rejects oversized draft records', () => {
    const x = setup(); const value = { ...prefs, draft: '123.' };
    expect(x.writePreferences(value)).toBe(true); expect(x.readPreferences()).toEqual(value);
    expect(x.writePreferences({ ...prefs, draft: 'x'.repeat(129) })).toBe(false); expect(x.readPreferences()).toEqual(value); x.close();
  });
  it('replaces future cache timestamps after a clock rollback', async () => {
    const x = setup(); await x.writeRates({ ...rates, checkedAt: Date.now() + 3600000 });
    expect(await x.writeRates({ ...rates, checkedAt: Date.now() })).toBe(true); expect((await x.readRates()).checkedAt).toBeLessThanOrEqual(Date.now()); x.close();
  });
  it('reports absent localStorage while retaining preferences in memory', () => {
    const onError = vi.fn(); const x = setup({ localStorage: undefined, onError });
    expect(x.writePreferences(prefs)).toBe(false); expect(x.readPreferences()).toEqual(prefs); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Saved preferences storage is unavailable.' })); x.close();
  });
  it('keeps data in memory when browser storage is blocked', async () => {
    const onError = vi.fn(); const x = setup({ indexedDB: null, localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, onError });
    x.writePreferences(prefs); await x.writeRates(rates); expect(x.readPreferences()).toEqual(prefs); expect(await x.readRates()).toEqual(rates); expect(onError).toHaveBeenCalled(); x.close();
  });
  it('receives other-tab preferences and removes the listener on close', () => {
    const eventTarget = new EventTarget(); const x = setup({ eventTarget }); const callback = vi.fn(); x.subscribe(callback);
    const value = { ...prefs, draft: '123.' };
    const event = () => Object.assign(new Event('storage'), { key: 'fex:preferences:v1', newValue: JSON.stringify({ version: 1, value }) });
    eventTarget.dispatchEvent(event()); expect(callback).toHaveBeenCalledWith({ type: 'preferences', value }); expect(x.readPreferences()).toEqual(value);
    x.close(); eventTarget.dispatchEvent(event()); expect(callback).toHaveBeenCalledTimes(1);
  });
  it('announces saved rates without broadcasting received messages again', async () => {
    const channels = [];
    class Channel {
      constructor() { channels.push(this); }
      onmessage = null;
      postMessage = vi.fn();
      close = vi.fn();
    }
    const x = setup({ BroadcastChannel: Channel }); const callback = vi.fn(); const dispose = x.subscribe(callback);
    await x.writeRates(rates); expect(channels[0].postMessage).toHaveBeenCalledWith({ type: 'rates' }); channels[0].onmessage({ data: { type: 'rates' } });
    expect(callback).toHaveBeenCalledWith({ type: 'rates' }); expect(channels[0].postMessage).toHaveBeenCalledTimes(1);
    dispose(); channels[0].onmessage({ data: { type: 'rates' } }); expect(callback).toHaveBeenCalledTimes(1); x.close(); expect(channels[0].close).toHaveBeenCalled();
  });
});
