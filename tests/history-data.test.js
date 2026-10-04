import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHistoryController, fetchHistory } from '../src/history-data.js';
import { getHistoryRange } from '../src/history.js';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const jsonResponse = rows => ({ ok: true, json: async () => rows });
function record({ base = 'USD', quote = 'EUR', from, to, checkedAt = NOW, points = [] }) {
  return { base, quote, from, to, points, checkedAt, lastUsedAt: checkedAt };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function storage({ records = [] } = {}) {
  return { readHistoryRecords: vi.fn().mockResolvedValue(records), writeHistory: vi.fn().mockResolvedValue(true) };
}
function setup({ records = [], loader = vi.fn(), now = () => NOW } = {}) {
  const saved = storage({ records });
  const changes = [];
  const controller = createHistoryController({ storage: saved, onChange: state => changes.push(state), fetchHistory: loader, now });
  return { controller, storage: saved, changes, loader };
}

afterEach(() => vi.useRealTimers());

describe('history API adapter', () => {
  it('requests one pair for the inclusive range and validates sorted points', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([
      { base: 'USD', quote: 'VND', date: '2026-09-26', rate: 26300 },
      { base: 'USD', quote: 'VND', date: '2026-09-25', rate: 26200 },
    ]));
    const result = await fetchHistory({ base: 'USD', quote: 'VND', from: '2026-09-25', to: '2026-09-27', fetchImpl, now: () => NOW });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(new URL(url).searchParams.toString()).toBe('base=USD&quotes=VND&from=2026-09-25&to=2026-09-27');
    expect(options).toMatchObject({ cache: 'no-store' });
    expect(result).toEqual({ base: 'USD', quote: 'VND', from: '2026-09-25', to: '2026-09-27', checkedAt: NOW, lastUsedAt: NOW, points: [{ date: '2026-09-25', rate: '26200' }, { date: '2026-09-26', rate: '26300' }] });
  });

  it('accepts an empty successful range and rejects a wrong pair', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    expect((await fetchHistory({ base: 'USD', quote: 'EUR', from: '2026-09-25', to: '2026-09-27', fetchImpl, now: () => NOW })).points).toEqual([]);
    fetchImpl.mockResolvedValue(jsonResponse([{ base: 'USD', quote: 'JPY', date: '2026-09-26', rate: 150 }]));
    await expect(fetchHistory({ base: 'USD', quote: 'EUR', from: '2026-09-25', to: '2026-09-27', fetchImpl })).rejects.toThrow('invalid row');
  });
});

describe('history controller loading and cache', () => {
  it('fetches only the selected period and saves its exact range', async () => {
    const bounds = getHistoryRange({ period: '1W', now: NOW });
    const loader = vi.fn().mockResolvedValue(record({ ...bounds, checkedAt: NOW, points: [{ date: bounds.to, rate: '0.9' }] }));
    const x = setup({ loader });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1W' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(expect.objectContaining({ base: 'USD', quote: 'EUR', ...bounds, signal: expect.any(AbortSignal) }));
    expect(x.storage.writeHistory).toHaveBeenCalledWith(expect.objectContaining({ ...bounds, checkedAt: NOW, lastUsedAt: NOW }));
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: { base: 'USD', quote: 'EUR', ...bounds }, refreshing: false });
  });

  it('reuses fresh covering records, including empty completed results', async () => {
    const bounds = getHistoryRange({ period: '1M', now: NOW });
    const larger = record({ from: '2026-08-01', to: '2026-10-01', checkedAt: NOW - 60000, points: [] });
    const loader = vi.fn();
    const x = setup({ records: [larger], loader });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    expect(loader).not.toHaveBeenCalled();
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: { ...bounds, points: [] }, refreshing: false });
  });

  it('prefers fresh broader coverage over a stale exact interval', async () => {
    const bounds = getHistoryRange({ period: '1M', now: NOW });
    const staleExact = record({ ...bounds, checkedAt: NOW - 2 * 3600000, points: [{ date: bounds.from, rate: '0.8' }, { date: bounds.to, rate: '0.9' }] });
    const freshBroad = record({ from: '2021-09-27', to: bounds.to, checkedAt: NOW - 5 * 60000, points: [{ date: bounds.from, rate: '1.2' }, { date: bounds.to, rate: '1.3' }] });
    const loader = vi.fn();
    const x = setup({ records: [staleExact, freshBroad], loader });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    expect(loader).not.toHaveBeenCalled();
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: { ...bounds, points: [{ date: bounds.from, rate: '1.2' }, { date: bounds.to, rate: '1.3' }] }, refreshing: false });
  });

  it('shows a prior adjacent interval while the selected period refreshes', async () => {
    const previousNow = Date.parse('2026-09-26T12:00:00Z');
    const oldBounds = getHistoryRange({ period: '1M', now: previousNow });
    const oldRecord = record({ ...oldBounds, checkedAt: NOW - 2 * 3600000, points: [{ date: '2026-09-25', rate: '0.9' }, { date: '2026-09-26', rate: '0.91' }] });
    const loader = vi.fn().mockResolvedValue(record({ ...getHistoryRange({ period: '1M', now: NOW }), checkedAt: NOW, points: [] }));
    const x = setup({ records: [oldRecord], loader });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    expect(x.changes).toContainEqual(expect.objectContaining({ phase: 'ready', refreshing: true, record: expect.objectContaining({ to: '2026-09-26' }) }));
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: { to: '2026-09-27' }, refreshing: false });
  });

  it('cuts a broader saved series to the selected range without adding dates', async () => {
    const bounds = getHistoryRange({ period: '1W', now: NOW });
    const broad = record({ from: '2026-09-01', to: bounds.to, checkedAt: NOW, points: [{ date: '2026-09-02', rate: '1' }, { date: bounds.from, rate: '2' }, { date: '2026-09-24', rate: '3' }] });
    const x = setup({ records: [broad] });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1W' });
    expect(x.controller.getState().record).toMatchObject({ ...bounds, points: [{ date: bounds.from, rate: '2' }, { date: '2026-09-24', rate: '3' }] });
  });

  it('keeps the visible series and makes no request when the same fresh range loads again', async () => {
    const bounds = getHistoryRange({ period: '1M', now: NOW });
    const loader = vi.fn().mockResolvedValue(record({ ...bounds, checkedAt: NOW, points: [{ date: bounds.to, rate: '0.9' }] }));
    const x = setup({ loader });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    const changes = x.changes.length;
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    expect(x.changes).toHaveLength(changes);
    expect(loader).toHaveBeenCalledOnce();
    expect(x.storage.readHistoryRecords).toHaveBeenCalledOnce();
  });

  it('refreshes a stale visible series without an empty loading state', async () => {
    const clock = { value: NOW };
    const bounds = getHistoryRange({ period: '1M', now: NOW });
    const loader = vi.fn(async () => record({ ...bounds, checkedAt: clock.value, points: [{ date: bounds.to, rate: '0.9' }] }));
    const x = setup({ loader, now: () => clock.value });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    x.storage.readHistoryRecords.mockResolvedValue([x.controller.getState().record]);
    const changes = x.changes.length;
    clock.value = NOW + 3600000;
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(x.changes.slice(changes).every(state => state.record !== null && state.phase === 'ready')).toBe(true);
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', refreshing: false, record: { checkedAt: NOW + 3600000 } });
  });

  it('uses cached data offline and reports offline without data for a new pair', async () => {
    const bounds = getHistoryRange({ period: '1M', now: NOW });
    const cached = record({ ...bounds, checkedAt: NOW, points: [] });
    const loader = vi.fn();
    const x = setup({ records: [cached], loader });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M', online: false });
    expect(x.controller.getState()).toMatchObject({ phase: 'offline', record: { base: 'USD', quote: 'EUR' } });
    await x.controller.load({ base: 'USD', quote: 'JPY', period: '1M', online: false });
    expect(x.controller.getState()).toMatchObject({ phase: 'offline', record: null });
    expect(loader).not.toHaveBeenCalled();
  });

  it('turns an unsupported-pair 404 into a cached empty range', async () => {
    const loader = vi.fn().mockRejectedValue(Object.assign(new Error('Not found.'), { status: 404 }));
    const x = setup({ loader });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: { points: [], base: 'USD', quote: 'EUR' }, error: null, retryAt: null });
    expect(x.storage.writeHistory).toHaveBeenCalledWith(expect.objectContaining({ points: [], base: 'USD', quote: 'EUR' }));
  });

  it('starts an online load when the connection returns during an offline load of the same range', async () => {
    const bounds = getHistoryRange({ period: '1M', now: NOW });
    const pendingRead = deferred();
    const loader = vi.fn().mockResolvedValue(record({ ...bounds, checkedAt: NOW, points: [] }));
    const x = setup({ loader });
    x.storage.readHistoryRecords.mockReturnValueOnce(pendingRead.promise);
    const offline = x.controller.load({ base: 'USD', quote: 'EUR', period: '1M', online: false });
    const online = x.controller.load({ base: 'USD', quote: 'EUR', period: '1M', online: true });
    expect(online).not.toBe(offline);
    pendingRead.resolve([]);
    await Promise.all([offline, online]);
    expect(loader).toHaveBeenCalledOnce();
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: bounds });
  });

  it('deduplicates the same in-flight selection', async () => {
    const bounds = getHistoryRange({ period: '1M', now: NOW });
    const pending = deferred();
    const loader = vi.fn(() => pending.promise);
    const x = setup({ loader });
    const first = x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    const second = x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    expect(second).toBe(first);
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    pending.resolve(record({ ...bounds, checkedAt: NOW }));
    await first;
    expect(loader).toHaveBeenCalledOnce();
  });

  it('aborts obsolete requests and ignores their late replies', async () => {
    const oldBounds = getHistoryRange({ period: '1M', now: NOW });
    const newBounds = getHistoryRange({ period: '3M', now: NOW });
    const oldPending = deferred();
    const loader = vi.fn(({ base, from, to }) => base === 'USD' ? oldPending.promise : Promise.resolve(record({ base: 'GBP', quote: 'USD', from, to, checkedAt: NOW, points: [] })));
    const x = setup({ loader });
    const oldLoad = x.controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    const oldSignal = loader.mock.calls[0][0].signal;
    const newLoad = x.controller.load({ base: 'GBP', quote: 'USD', period: '3M' });
    expect(oldSignal.aborted).toBe(true);
    await newLoad;
    oldPending.resolve(record({ base: 'USD', quote: 'EUR', ...oldBounds, checkedAt: NOW, points: [] }));
    await oldLoad;
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: { base: 'GBP', quote: 'USD', ...newBounds } });
    expect(x.changes.some(state => state.record?.base === 'USD' && state.phase === 'ready')).toBe(false);
  });

  it('deactivates while storage is loading and does not start a request later', async () => {
    const pendingRead = deferred();
    const saved = storage(); saved.readHistoryRecords.mockReturnValue(pendingRead.promise);
    const loader = vi.fn();
    const changes = [];
    const controller = createHistoryController({ storage: saved, onChange: state => changes.push(state), fetchHistory: loader, now: () => NOW });
    const load = controller.load({ base: 'USD', quote: 'EUR', period: '1M' });
    controller.deactivate();
    pendingRead.resolve([]);
    await load;
    expect(loader).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({ phase: 'idle', record: null });
  });

  it('keeps a Retry-After cooldown across pair changes and does not let force bypass it', async () => {
    const clock = { value: NOW };
    const firstError = Object.assign(new Error('Rate limited.'), { status: 429, retryAfterMs: 120000 });
    const bounds = getHistoryRange({ period: '1W', now: NOW + 120000 });
    const loader = vi.fn()
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(record({ base: 'GBP', quote: 'USD', ...bounds, checkedAt: NOW + 120000, points: [] }));
    const x = setup({ loader, now: () => clock.value });
    await x.controller.load({ base: 'USD', quote: 'EUR', period: '1W' });
    const retryAt = NOW + 120000;
    expect(x.controller.getState()).toMatchObject({ phase: 'error', retryAt });
    await x.controller.load({ base: 'GBP', quote: 'USD', period: '1W', force: true });
    expect(loader).toHaveBeenCalledOnce();
    expect(x.controller.getState()).toMatchObject({ phase: 'error', retryAt });
    clock.value = retryAt;
    await x.controller.load({ base: 'GBP', quote: 'USD', period: '1W' });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(x.controller.getState()).toMatchObject({ phase: 'ready', record: { base: 'GBP', quote: 'USD' } });
  });

  it('does not report a canceled request as an error or set a retry time', async () => {
    const pending = deferred();
    const loader = vi.fn(() => pending.promise);
    const x = setup({ loader });
    const load = x.controller.load({ base: 'USD', quote: 'EUR', period: '1W' });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    x.controller.deactivate();
    pending.reject(Object.assign(new Error('Aborted.'), { name: 'AbortError' }));
    await load;
    expect(x.controller.getState()).toMatchObject({ phase: 'idle', retryAt: null, error: null });
  });
});
