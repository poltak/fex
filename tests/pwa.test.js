import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/pwa/sw.js', import.meta.url), 'utf8');
function worker({ clients = [], keys = [] } = {}) {
  const handlers = {};
  const cache = { addAll: vi.fn(async () => {}), match: vi.fn(async () => new Response('cached')) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => keys), delete: vi.fn(async () => true) };
  const self = {
    __WB_MANIFEST: [{ url: 'index.html', revision: '1' }, { url: 'assets/app.js', revision: null }],
    registration: { scope: 'https://example.test/fex/' },
    clients: { matchAll: vi.fn(async () => clients), claim: vi.fn(async () => {}) },
    addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: vi.fn(),
  };
  vm.runInNewContext(source, { self, caches, URL, Request, __FEX_BUILD_ID__: 'test', fetch: vi.fn() });
  return { handlers, self, cache, caches };
}
describe('scoped service worker', () => {
  it('installs all build assets without forcing activation', async () => {
    const w = worker(); let pending;
    w.handlers.install({ waitUntil: promise => { pending = promise; } });
    await pending;
    expect(w.cache.addAll.mock.calls[0][0].map(request => request.url)).toEqual(['https://example.test/fex/index.html', 'https://example.test/fex/assets/app.js']);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    w.handlers.message({ data: { type: 'FEX_ACCEPT_UPDATE' } });
    expect(w.self.skipWaiting).toHaveBeenCalledOnce();
  });
  it('does not intercept API calls, other app paths, or unknown navigation', () => {
    const w = worker();
    for (const url of ['https://api.frankfurter.dev/v2/rates', 'https://example.test/other/', 'https://example.test/fex/missing']) {
      const respondWith = vi.fn();
      w.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it('returns cached scoped navigation immediately', async () => {
    const w = worker(); let response;
    w.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test/fex/?launch=1' }, respondWith: promise => { response = promise; } });
    expect(await (await response).text()).toBe('cached');
    expect(w.cache.match).toHaveBeenCalledWith('https://example.test/fex/index.html', { ignoreVary: true });
  });
  it('cleans only this scope when no app tab needs old code', async () => {
    const w = worker({ keys: ['other', 'fex-shell:/:old', 'fex-shell:/fex/:old', 'fex-shell:/fex/:test'] }); let pending;
    w.handlers.activate({ waitUntil: promise => { pending = promise; } });
    await pending;
    expect(w.caches.delete.mock.calls).toEqual([['fex-shell:/fex/:old']]);
  });
  it('keeps old hashed assets while an app tab is open', async () => {
    const w = worker({ keys: ['fex-shell:/fex/:old'], clients: [{ url: 'https://example.test/fex/' }] }); let pending;
    w.handlers.activate({ waitUntil: promise => { pending = promise; } });
    await pending;
    expect(w.caches.delete).not.toHaveBeenCalled();
  });
  it('retires old scoped caches when the only client has loaded this build', async () => {
    const w = worker({ keys: ['fex-shell:/fex/:old', 'fex-shell:/fex/:test', 'unrelated'], clients: [{ id: 'one', url: 'https://example.test/fex/' }] }); let pending;
    w.handlers.message({ data: { type: 'FEX_CLIENT_READY', version: 'test' }, source: { id: 'one' }, waitUntil: promise => { pending = promise; } });
    await pending;
    expect(w.caches.delete.mock.calls).toEqual([['fex-shell:/fex/:old']]);
  });
  it.each(['old-version', 'another-tab', 'waiting', 'installing', 'wrong-source'])('retains caches for unsafe client readiness: %s', async condition => {
    const clients = [{ id: 'one', url: 'https://example.test/fex/' }];
    if (condition === 'another-tab') clients.push({ id: 'two', url: 'https://example.test/fex/' });
    const w = worker({ keys: ['fex-shell:/fex/:old'], clients }); let pending;
    if (condition === 'waiting' || condition === 'installing') w.self.registration[condition] = {};
    w.handlers.message({ data: { type: 'FEX_CLIENT_READY', version: condition === 'old-version' ? 'old' : 'test' }, source: { id: condition === 'wrong-source' ? 'other' : 'one' }, waitUntil: promise => { pending = promise; } });
    await pending;
    expect(w.caches.delete).not.toHaveBeenCalled();
  });
  it('rechecks for a new worker after the async cache lookup', async () => {
    const w = worker({ clients: [{ id: 'one', url: 'https://example.test/fex/' }] }); let pending;
    w.caches.keys.mockImplementation(async () => { w.self.registration.waiting = {}; return ['fex-shell:/fex/:next']; });
    w.handlers.message({ data: { type: 'FEX_CLIENT_READY', version: 'test' }, source: { id: 'one' }, waitUntil: promise => { pending = promise; } });
    await pending;
    expect(w.caches.delete).not.toHaveBeenCalled();
  });
});
