import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateController, fetchCatalog, fetchRates, isFresh, validateCatalog, validateSnapshot } from '../src/data.js';
const snapshot = (checkedAt = 100, date = '2026-09-25', rate = '0.9') => ({ base: 'USD', checkedAt, rates: { USD: { rate: '1', date }, EUR: { rate, date } } });
const response = rows => ({ ok: true, json: async () => rows });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());
describe('cache freshness', () => {
  it('uses the same bounded clock policy for hourly rates and daily catalogs', () => {
    const now = 100000000;
    for (const maxAge of [3600000, 86400000]) {
      expect(isFresh({ checkedAt: now - maxAge + 1, maxAge, now })).toBe(true);
      expect(isFresh({ checkedAt: now - maxAge, maxAge, now })).toBe(false);
      expect(isFresh({ checkedAt: now + 300000, maxAge, now })).toBe(true);
      expect(isFresh({ checkedAt: now + 86400000, maxAge, now })).toBe(false);
    }
  });
});
describe('API validation', () => {
  it('normalizes full catalogs and keeps units without symbols', async () => {
    expect(await fetchCatalog({ fetchImpl: vi.fn().mockResolvedValue(response([{ iso_code: 'USD', name: 'US Dollar', symbol: '$' }, { iso_code: 'XAU', name: 'Gold' }])) })).toEqual([{ code: 'USD', name: 'US Dollar', symbol: '$' }, { code: 'XAU', name: 'Gold', symbol: '' }]);
  });
  it('rejects empty and conflicting catalogs', () => {
    expect(() => validateCatalog([])).toThrow();
    expect(() => validateCatalog([{ code: 'USD', name: 'Dollar' }, { code: 'USD', name: 'Other' }])).toThrow();
  });
  it('normalizes rates and adds the USD identity', async () => {
    const result = await fetchRates({ now: () => 123, fetchImpl: vi.fn().mockResolvedValue(response([{ base: 'USD', quote: 'EUR', rate: 0.9, date: '2026-09-25' }])) });
    expect(result).toEqual(snapshot(123));
  });
  it.each([0, -1, Infinity, 'NaN', '', null])('rejects invalid rate %s', rate => {
    const record = snapshot(); record.rates.EUR.rate = rate;
    expect(() => validateSnapshot(record)).toThrow();
  });
  it('rejects impossible dates and conflicting duplicates', async () => {
    const record = snapshot(); record.rates.EUR.date = '2026-02-30';
    expect(() => validateSnapshot(record)).toThrow();
    await expect(fetchRates({ fetchImpl: vi.fn().mockResolvedValue(response([{ base: 'USD', quote: 'EUR', rate: 1, date: '2026-09-25' }, { base: 'USD', quote: 'EUR', rate: 2, date: '2026-09-25' }])) })).rejects.toThrow('conflicting');
  });
  it('exposes 429 retry delay', async () => {
    await expect(fetchRates({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => '90' } }) })).rejects.toMatchObject({ status: 429, retryAfterMs: 90000 });
  });
  it('times out even if the transport does not respond to abort', async () => {
    vi.useFakeTimers();
    const request = fetchRates({ fetchImpl: vi.fn(() => new Promise(() => {})) });
    const check = expect(request).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10000); await check;
  });
});
function setup({ saved = null, loader = vi.fn().mockResolvedValue(snapshot(4000000)), time = 4000000 } = {}) {
  let clock = time, editing = false, source = 'USD';
  const storage = { readRates: vi.fn().mockResolvedValue(saved), writeRates: vi.fn().mockResolvedValue(true) };
  const apply = vi.fn();
  const controller = createRateController({ storage, onApply: apply, getSource: () => source, isEditing: () => editing, now: () => clock, fetchRates: loader });
  return { controller, storage, apply, loader, setTime: value => { clock = value; }, setEditing: value => { editing = value; }, setSource: value => { source = value; } };
}
describe('rate controller', () => {
  it('uses the one-hour TTL and skips hidden/offline refreshes', async () => {
    const x = setup({ saved: snapshot(100), time: 3599999 }); await x.controller.restore();
    await x.controller.refresh(); expect(x.loader).not.toHaveBeenCalled();
    x.setTime(3600100); await x.controller.refresh({ visible: false }); await x.controller.refresh({ online: false }); expect(x.loader).not.toHaveBeenCalled();
    await x.controller.refresh(); expect(x.loader).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent lifecycle requests', async () => {
    const d = deferred(); const x = setup({ loader: vi.fn(() => d.promise) });
    const first = x.controller.refresh(); const second = x.controller.refresh({ force: true });
    expect(first).toBe(second); d.resolve(snapshot()); await first; expect(x.loader).toHaveBeenCalledTimes(1);
  });
  it('does not let a late restore replace network data', async () => {
    const d = deferred(); const x = setup(); x.storage.readRates.mockReturnValue(d.promise);
    const restore = x.controller.restore(); await x.controller.refresh(); d.resolve(snapshot(1)); await restore;
    expect(x.apply).toHaveBeenCalledTimes(1); expect(x.apply.mock.calls[0][0].checkedAt).toBe(4000000);
  });
  it('persists a pending update and keeps the displayed timestamp until editing ends', async () => {
    const x = setup({ saved: snapshot(100) }); await x.controller.restore(); x.setEditing(true); await x.controller.refresh();
    expect(x.storage.writeRates).toHaveBeenCalled(); expect(x.controller.getStatus()).toMatchObject({ pending: true, checkedAt: 100 }); expect(x.apply).toHaveBeenCalledTimes(1);
    x.controller.flushPending(); expect(x.apply).toHaveBeenCalledTimes(1);
    x.setEditing(false); x.controller.flushPending(); expect(x.controller.getStatus()).toMatchObject({ pending: false, checkedAt: 4000000 });
  });
  it('checks the active source when applying pending data', async () => {
    const saved = snapshot(100); saved.rates.JPY = { rate: '150', date: '2026-09-25' };
    const x = setup({ saved }); await x.controller.restore(); x.setEditing(true); await x.controller.refresh(); x.setSource('JPY'); x.setEditing(false); x.controller.flushPending();
    expect(x.apply).toHaveBeenCalledTimes(1); expect(x.controller.getStatus().error).toContain('source');
  });
  it('preserves usable data when the active source is absent', async () => {
    const x = setup({ saved: snapshot(100) }); await x.controller.restore(); x.setSource('EUR');
    x.loader.mockResolvedValue({ base: 'USD', checkedAt: 4000000, rates: { USD: { rate: '1', date: '2026-09-25' }, JPY: { rate: '150', date: '2026-09-25' } } });
    await x.controller.refresh(); expect(x.apply).toHaveBeenCalledTimes(1); expect(x.storage.writeRates).not.toHaveBeenCalled();
    expect(x.controller.getStatus().retryAt).toBe(4060000); await x.controller.refresh(); expect(x.loader).toHaveBeenCalledTimes(1);
  });
  it('accepts available rates on cold start when the selected source is missing', async () => {
    const x = setup(); x.setSource('JPY'); await x.controller.refresh();
    expect(x.apply).toHaveBeenCalledTimes(1); expect(x.storage.writeRates).toHaveBeenCalled();
    expect(x.controller.getStatus()).toMatchObject({ phase: 'error', error: 'The source currency has no current rate.' });
    await x.controller.refresh();
    expect(x.loader).toHaveBeenCalledTimes(1);
    expect(x.controller.getStatus()).toMatchObject({ phase: 'error', error: 'The source currency has no current rate.' });
  });
  it('applies a cold-start partial table after the draft ends', async () => {
    const x = setup(); x.setSource('JPY'); x.setEditing(true); await x.controller.refresh(); expect(x.apply).not.toHaveBeenCalled();
    x.setEditing(false); x.controller.flushPending(); expect(x.apply).toHaveBeenCalledTimes(1); expect(x.controller.getStatus().error).toContain('source');
  });
  it('backs off when a response has older dates', async () => {
    const x = setup({ saved: snapshot(100), loader: vi.fn().mockResolvedValue(snapshot(4000000, '2026-09-24')) });
    await x.controller.restore(); await x.controller.refresh();
    expect(x.controller.getStatus()).toMatchObject({ phase: 'error', retryAt: 4060000, checkedAt: 100 });
    await x.controller.refresh(); expect(x.loader).toHaveBeenCalledTimes(1); expect(x.storage.writeRates).not.toHaveBeenCalled();
  });
  it('accepts newer cross-tab records, rejects date regressions, and queues during editing', async () => {
    const x = setup({ saved: snapshot(100) }); await x.controller.restore();
    expect(x.controller.acceptSaved(snapshot(99))).toBe(false); expect(x.controller.acceptSaved(snapshot(200, '2026-09-24'))).toBe(false);
    x.setEditing(true); expect(x.controller.acceptSaved(snapshot(300))).toBe(true); expect(x.controller.getStatus().pending).toBe(true);
  });
  it('keeps the error status when a saved snapshot is not newer', async () => {
    const x = setup({ saved: snapshot(100), loader: vi.fn().mockRejectedValue(new Error('Network failed')) });
    await x.controller.restore(); await x.controller.refresh();
    expect(x.controller.getStatus()).toMatchObject({ phase: 'error', error: 'Network failed', retryAt: 4060000 });
    expect(x.controller.acceptSaved(snapshot(100))).toBe(false);
    expect(x.controller.getStatus()).toMatchObject({ phase: 'error', error: 'Network failed', retryAt: 4060000 });
  });
  it('updates the check time when rates are unchanged', async () => {
    const x = setup({ saved: snapshot(100) }); await x.controller.restore(); await x.controller.refresh();
    expect(x.controller.getStatus().checkedAt).toBe(4000000);
  });
  it('refreshes future cache timestamps and accepts current data after clock rollback', async () => {
    const x = setup({ saved: snapshot(8000000), time: 4000000 }); await x.controller.restore(); await x.controller.refresh();
    expect(x.loader).toHaveBeenCalledTimes(1); expect(x.controller.getStatus().checkedAt).toBe(4000000); expect(x.storage.writeRates).toHaveBeenCalledWith(snapshot(4000000));
  });
  it('still rejects older rate dates during clock rollback recovery', async () => {
    const x = setup({ saved: snapshot(8000000), time: 4000000, loader: vi.fn().mockResolvedValue(snapshot(4000000, '2026-09-24')) }); await x.controller.restore(); await x.controller.refresh();
    expect(x.controller.getStatus()).toMatchObject({ checkedAt: 8000000, phase: 'error', retryAt: 4060000 }); expect(x.storage.writeRates).not.toHaveBeenCalled();
  });
  it('uses retry backoff and never bypasses a 429 cooldown', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('Network failed')); const x = setup({ loader, time: 0 });
    await x.controller.refresh(); expect(x.controller.getStatus().retryAt).toBe(60000); await x.controller.refresh(); expect(loader).toHaveBeenCalledTimes(1);
    x.setTime(60000); await x.controller.refresh(); expect(x.controller.getStatus().retryAt).toBe(360000);
    loader.mockRejectedValue(Object.assign(new Error('Busy'), { status: 429, retryAfterMs: 90000 })); await x.controller.refresh({ force: true });
    expect(x.controller.getStatus().retryAt).toBe(150000); await x.controller.refresh({ force: true }); expect(loader).toHaveBeenCalledTimes(3);
  });
  it('aborts requests and prevents late application after destruction', async () => {
    const d = deferred(); const x = setup({ loader: vi.fn(() => d.promise) }); const request = x.controller.refresh();
    await Promise.resolve(); const signal = x.loader.mock.calls[0][0].signal; x.controller.destroy(); expect(signal.aborted).toBe(true); d.resolve(snapshot()); await request; expect(x.apply).not.toHaveBeenCalled();
  });
});
