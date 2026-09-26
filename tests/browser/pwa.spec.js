import { test, expect } from '@playwright/test';
import { FALLBACK_CATALOG } from '../../src/catalog.js';
import { createPwaServer } from './pwa-server.js';

const values = { USD: 1, VND: 25000, EUR: 0.9, SGD: 1.3, AUD: 1.5, THB: 35, GBP: 0.75, IDR: 15000 };
async function serveRates(context) {
  await context.route('https://api.frankfurter.dev/**', route => {
    const catalog = route.request().url().includes('/currencies');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalog ? FALLBACK_CATALOG : FALLBACK_CATALOG.filter(item => item.code !== 'USD').map(item => ({ base: 'USD', quote: item.code, rate: values[item.code] || 2, date: new Date().toISOString().slice(0, 10) }))) });
  });
}
async function waitForWorker(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
async function waitForSavedRates(page) {
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('fex-cache', 1);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('cache').objectStore('cache').get('rates');
      read.onsuccess = () => { resolve(!!read.result); db.close(); };
    };
  }))).toBe(true);
}

async function lifecycle({ browser, base, offline }) {
  test.setTimeout(90_000);
  const server = await createPwaServer({ base });
  const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'allow' });
  try {
    await serveRates(context);
    let page = await context.newPage();
    const initialResponse = await page.goto(server.url);
    await expect(page.locator('#amount-EUR')).toHaveValue('9.00');
    if (base === '/fex/') expect(initialResponse.headers()['content-security-policy']).toBeUndefined();
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain('frame-ancestors');
    await page.evaluate(() => {
      window.addEventListener('securitypolicyviolation', event => { window.__fexCspViolation = event.blockedURI; }, { once: true });
      const script = document.createElement('script');
      script.textContent = 'window.__fexInlineCspTest = true';
      document.head.append(script);
      script.remove();
    });
    await expect.poll(() => page.evaluate(() => window.__fexCspViolation)).toBe('inline');
    expect(await page.evaluate(() => window.__fexInlineCspTest)).toBeUndefined();
    await waitForWorker(page);
    await waitForSavedRates(page);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope)).toBe(server.url);
    const missing = await context.newPage();
    const missingResponse = await missing.goto(`${server.url}not-an-app-route`);
    expect(missingResponse.status()).toBe(404);
    expect(missingResponse.fromServiceWorker()).toBe(false);
    if (base !== '/') {
      await missing.goto(`${server.origin}/outside-fex`);
      expect(await missing.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
    }
    await missing.close();

    await page.locator('#amount-USD').fill('12');
    await page.locator('#amount-USD').press('Enter');
    await context.unroute('https://api.frankfurter.dev/**');
    await context.setOffline(offline);
    await page.close();
    page = await context.newPage();
    const response = await page.goto(server.url);
    expect(response.fromServiceWorker()).toBe(true);
    await expect(page.locator('#amount-USD')).toHaveValue('12.00');
    await expect(page.locator('#amount-EUR')).toHaveValue('10.80');
    if (offline) await expect(page.locator('#status-primary')).toHaveText('Offline — using saved rates');
    await page.locator('#amount-USD').fill('20');
    await expect(page.locator('#amount-EUR')).toHaveValue('18.00');

    await context.setOffline(false);
    await serveRates(context);
    await page.locator('#amount-USD').fill('123.45');
    const oldTab = await context.newPage();
    await oldTab.goto(server.url);
    await waitForWorker(oldTab);
    const oldTabStart = await oldTab.evaluate(() => performance.timeOrigin);
    await page.bringToFront();
    const documentStart = await page.evaluate(() => performance.timeOrigin);
    server.useVersion('B');
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await expect(page.locator('#update-notice')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
    await expect(page.locator('#amount-USD')).toHaveValue('123.45');
    await expect(page.locator('#amount-USD')).toBeFocused();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
    await page.locator('#amount-USD').press('End');
    await page.locator('#amount-USD').pressSequentially('6');
    await expect(page.locator('#amount-USD')).toHaveValue('123.456');
    await Promise.all([page.waitForEvent('load'), page.locator('#update-now').click()]);
    await expect(page.locator('#amount-USD')).toHaveValue('123.46');
    await page.locator('#amount-USD').focus();
    await expect(page.locator('#amount-USD')).toHaveValue('123.456');
    expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(documentStart);
    await expect(page.locator('#update-notice')).toBeHidden();
    expect(await page.evaluate(async () => (await caches.keys()).some(key => key.endsWith('browser-B')))).toBe(true);
    expect(await page.evaluate(async () => (await caches.keys()).some(key => key.endsWith('browser-A')))).toBe(true);
    await expect(oldTab.locator('#update-notice')).toBeHidden();
    expect(await oldTab.evaluate(() => performance.timeOrigin)).toBe(oldTabStart);
    await oldTab.close();
    // WebKit can retain a just-closed client briefly. A later resume retries cleanup.
    await expect.poll(() => page.evaluate(async () => {
      window.dispatchEvent(new Event('focus'));
      return (await caches.keys()).filter(key => key.startsWith('fex-shell:'));
    })).toEqual([`fex-shell:${base}:browser-B`]);

    await page.locator('#amount-USD').press('Enter');
    await context.unroute('https://api.frankfurter.dev/**');
    await context.setOffline(offline);
    const updatedResponse = await page.reload();
    expect(updatedResponse.fromServiceWorker()).toBe(true);
    await expect(page.locator('#amount-USD')).toHaveValue('123.46');
    await expect(page.locator('#amount-EUR')).toHaveValue('111.11');

    // Incomplete text must survive both an offline reload and an accepted rollback.
    await page.locator('#amount-USD').fill('123.');
    await expect(page.locator('#amount-EUR')).toHaveValue('');
    await page.reload();
    await expect(page.locator('#amount-USD')).toHaveValue('123.');
    await expect(page.locator('#amount-EUR')).toHaveValue('');
    await context.setOffline(false);
    await serveRates(context);
    await page.locator('#amount-USD').focus();
    server.useVersion('A');
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await expect(page.locator('#update-notice')).toBeVisible();
    await expect(page.locator('#amount-USD')).toHaveValue('123.');
    await expect(page.locator('#amount-EUR')).toHaveValue('');
    await Promise.all([page.waitForEvent('load'), page.locator('#update-now').click()]);
    await expect(page.locator('#amount-USD')).toHaveValue('123.');
    await expect(page.locator('#amount-EUR')).toHaveValue('');
    await expect(page.locator('#update-notice')).toBeHidden();

    // Invalid pasted text remains an error, never a zero or an old conversion.
    await page.locator('#amount-USD').fill('12oops');
    await expect(page.locator('#amount-USD')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#amount-EUR')).toHaveValue('');
    await context.unroute('https://api.frankfurter.dev/**');
    await context.setOffline(offline);
    await page.reload();
    await expect(page.locator('#amount-USD')).toHaveValue('12oops');
    await expect(page.locator('#amount-USD')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#error-USD')).toBeVisible();
    await expect(page.locator('#amount-EUR')).toHaveValue('');
    const cacheUrls = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat());
    expect(cacheUrls.every(url => url.startsWith(server.url))).toBe(true);
    expect(cacheUrls.some(url => url.includes('frankfurter'))).toBe(false);
  } finally { await context.close(); await server.close(); }
}

for (const base of ['/', '/fex/']) {
  test(`real worker accepts updates and rollback without losing drafts at ${base}`, async ({ browser }) => {
    await lifecycle({ browser, base, offline: false });
  });
  test(`real worker reopens offline and preserves all draft states at ${base}`, async ({ browser, browserName }) => {
    test.skip(browserName === 'webkit', 'Playwright WebKit returns an internal navigation error with setOffline(true), for reload and new-page navigation, including a persistent profile and ignoreVary cache matching. Actual Safari/iOS offline launch remains unverified.');
    await lifecycle({ browser, base, offline: true });
  });
}

test('first Fex install under a broader worker has no false update prompt', async ({ browser }) => {
  test.setTimeout(60_000);
  const server = await createPwaServer({ base: '/fex/' });
  const context = await browser.newContext({ locale: 'en-US', serviceWorkers: 'allow' });
  try {
    await serveRates(context);
    const page = await context.newPage();
    await page.goto(`${server.origin}/broader.html`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/broader-worker.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${server.origin}/broader-worker.js`);
    // WebKit can bypass Playwright network routes under the broader worker.
    // Seed fresh real storage so this lifecycle regression never needs live rates.
    await page.evaluate(async ({ catalog, values }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('fex-cache', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('cache');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const date = new Date().toISOString().slice(0, 10);
      const checkedAt = Date.now();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({ version: 1, value: { base: 'USD', checkedAt, rates: Object.fromEntries(Object.entries(values).map(([code, rate]) => [code, { rate: String(rate), date }])) } }, 'rates');
        tx.objectStore('cache').put({ version: 1, value: { items: catalog, checkedAt } }, 'catalog');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, { catalog: FALLBACK_CATALOG, values });
    await page.goto(server.url);
    await expect(page.locator('#amount-EUR')).toHaveValue('9.00');
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${server.url}sw.js`);
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(false);
    await expect(page.locator('#update-notice')).toBeHidden();
  } finally { await context.close(); await server.close(); }
});
