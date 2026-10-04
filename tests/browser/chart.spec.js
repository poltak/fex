import { test, expect } from '@playwright/test';
import { amount, catalog, historyRows, mockApi, rateRows, savedKeys, values } from './fixtures.js';

test.use({ serviceWorkers: 'block' });

async function openChart(page) {
  await page.locator('#chart-tab').click();
  await expect(page.locator('#chart-screen')).toBeVisible();
  await expect(page.locator('#chart-heading')).toBeVisible();
}

async function waitForHistory(page) {
  await expect.poll(() => page.locator('#chart-status').getAttribute('data-phase')).toBe('ready');
}

async function hasSavedHistory(page) {
  return (await savedKeys(page)).some(key => key.startsWith('history:v1:'));
}

async function hasSavedCatalogCode(page, code) {
  return page.evaluate(code => new Promise(resolve => {
    const request = indexedDB.open('fex-cache', 1);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('cache').objectStore('cache').get('catalog');
      read.onsuccess = () => {
        resolve(read.result?.value?.items?.some(item => item.code === code) || false);
        db.close();
      };
      read.onerror = () => { resolve(false); db.close(); };
    };
    request.onerror = () => resolve(false);
  }), code);
}

async function selectPeriod(page, period) {
  const button = page.locator(`[data-chart-period="${period}"]`);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  return button;
}

test('does not request history on converter startup or amount edits; loads one selected period on demand', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  expect(calls.history).toBe(0);
  const latestRateCalls = calls.rates;

  await amount(page, 'USD').fill('12');
  await expect(amount(page, 'EUR')).toHaveValue('10.80');
  expect(calls.history).toBe(0);
  expect(calls.rates).toBe(latestRateCalls);

  await openChart(page);
  await waitForHistory(page);
  expect(calls.history).toBe(1);
  expect(calls.historyRequests).toHaveLength(1);
  expect(calls.historyRequests[0]).toMatchObject({ base: 'USD', quote: 'VND' });
  expect(calls.historyRequests[0].from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(calls.historyRequests[0].to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('[data-chart-period="1M"]')).toHaveAttribute('aria-pressed', 'true');
});

test('loads all five periods on demand', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/#chart?base=USD&quote=VND&period=1W');
  await expect(page.locator('#chart-screen')).toBeVisible();
  await waitForHistory(page);
  await expect(page.locator('[data-chart-period="1W"]')).toHaveAttribute('aria-pressed', 'true');

  for (const period of ['1M', '3M', '1Y', '5Y']) {
    await selectPeriod(page, period);
    await waitForHistory(page);
  }
  expect(calls.history).toBe(5);
  expect(new Set(calls.historyRequests.map(request => `${request.from}:${request.to}`)).size).toBe(5);
  const spans = calls.historyRequests.map(request => (Date.parse(request.to) - Date.parse(request.from)) / 86400000);
  expect(spans).toContain(7);
  expect(spans.some(days => days >= 28 && days <= 31)).toBe(true);
  expect(spans.some(days => days >= 89 && days <= 92)).toBe(true);
  expect(spans.some(days => days >= 365 && days <= 366)).toBe(true);
  expect(spans.some(days => days >= 1825 && days <= 1827)).toBe(true);

  for (const request of calls.historyRequests) {
    expect(request.base).toBe('USD');
    expect(request.quote).toBe('VND');
  }
});

test('uses a fresh cached five-year response for a shorter period', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  await selectPeriod(page, '5Y');
  await waitForHistory(page);
  expect(calls.history).toBe(2);
  await selectPeriod(page, '1Y');
  await waitForHistory(page);
  expect(calls.history).toBe(2);
});

test('swap and single-currency picker change only the chart pair', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/');
  await amount(page, 'USD').fill('25');
  await openChart(page);
  await waitForHistory(page);

  await page.locator('#chart-swap').click();
  await expect(page.locator('#chart-base')).toHaveAccessibleName(/^Base currency: VND/);
  await expect(page.locator('#chart-quote')).toHaveAccessibleName(/^Quote currency: USD/);
  await expect.poll(() => calls.history).toBe(2);
  await waitForHistory(page);

  await page.locator('#chart-base').click();
  const picker = page.locator('#chart-picker');
  await expect(picker).toBeVisible();
  await page.locator('#chart-currency-search').fill('EUR');
  await page.getByRole('radio', { name: 'Select EUR, Euro' }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('#chart-base')).toHaveAccessibleName(/^Base currency: EUR/);
  await expect(page.locator('#chart-quote')).toHaveAccessibleName(/^Quote currency: USD/);
  await expect.poll(() => calls.history).toBe(3);
  await waitForHistory(page);

  // A choice of the current currency closes the picker and changes nothing.
  await page.locator('#chart-quote').click();
  await page.getByRole('radio', { name: /^Select USD/ }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('#chart-quote')).toHaveAccessibleName(/^Quote currency: USD/);
  expect(calls.history).toBe(3);

  await page.locator('#convert-tab').click();
  await expect(page.locator('#convert-screen')).toBeVisible();
  await expect(amount(page, 'USD')).toHaveValue('25.00');
  await expect(page.locator('.currency-card')).toHaveCount(8);
});

test('a currency card opens its source-to-quote history without changing the converter', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await page.locator('[data-code="EUR"].currency-card [data-history-quote="EUR"]').click();
  await expect(page.locator('#chart-screen')).toBeVisible();
  await waitForHistory(page);
  await expect(page.locator('#chart-base')).toHaveAccessibleName(/^Base currency: USD/);
  await expect(page.locator('#chart-quote')).toHaveAccessibleName(/^Quote currency: EUR/);
  expect(calls.history).toBe(1);
  expect(calls.historyRequests[0]).toMatchObject({ base: 'USD', quote: 'EUR' });
  await page.locator('#convert-tab').click();
  await expect(amount(page, 'USD')).toHaveValue('10.00');
});

test('browser Back and reload preserve the converter draft; invalid chart fragments use safe defaults', async ({ page }) => {
  const calls = await mockApi(page);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await amount(page, 'USD').fill('10.');
  await openChart(page);
  await waitForHistory(page);
  expect(await page.evaluate(() => location.hash)).toMatch(/^#chart\?/);

  await page.goBack();
  await expect(page.locator('#convert-screen')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('');
  await expect(amount(page, 'USD')).toHaveValue('10.');
  await page.goForward();
  await expect(page.locator('#chart-screen')).toBeVisible();
  await page.reload();
  await expect(page.locator('#chart-screen')).toBeVisible();
  await waitForHistory(page);

  await page.goto('/#chart?base=NOPE&quote=USD&period=9D');
  await expect(page.locator('#chart-screen')).toBeVisible();
  await expect(page.locator('#chart-base')).toHaveAccessibleName(/^Base currency: USD/);
  await expect(page.locator('#chart-quote')).toHaveAccessibleName(/^Quote currency: VND/);
  await expect(page.locator('[data-chart-period="1M"]')).toHaveAttribute('aria-pressed', 'true');
  await waitForHistory(page);
  expect(calls.historyRequests.at(-1)).toMatchObject({ base: 'USD', quote: 'VND' });
  expect(pageErrors).toEqual([]);
});

test('reload accepts a chart pair code from the saved catalog when it is not in the converter list', async ({ page }) => {
  const extraCode = { iso_code: 'XTS', name: 'Test Settlement Unit', symbol: 'XTS' };
  const calls = await mockApi(page, { catalogRows: [...catalog, extraCode] });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await expect.poll(() => hasSavedCatalogCode(page, 'XTS')).toBe(true);

  await page.evaluate(() => history.replaceState(null, '', `${location.pathname}#chart?base=USD&quote=XTS&period=1W`));
  await page.reload();
  await expect(page.locator('#chart-screen')).toBeVisible();
  await expect(page.locator('#chart-quote')).toHaveAccessibleName(/^Quote currency: XTS, Test Settlement Unit/);
  await expect(page.locator('[data-chart-period="1W"]')).toHaveAttribute('aria-pressed', 'true');
  await waitForHistory(page);
  expect(calls.historyRequests.at(-1)).toMatchObject({ base: 'USD', quote: 'XTS' });
  await expect(page.locator('.currency-card')).toHaveCount(8);
});

test('opening Chart from Convert waits for a delayed saved catalog before using saved chart settings', async ({ page }) => {
  const extraCode = { iso_code: 'XTS', name: 'Test Settlement Unit', symbol: 'XTS' };
  const calls = await mockApi(page, { catalogRows: [...catalog, extraCode] });
  await page.goto('/');
  await expect.poll(() => hasSavedCatalogCode(page, 'XTS')).toBe(true);
  await page.evaluate(() => localStorage.setItem('fex:chart-settings:v1', JSON.stringify({
    version: 1,
    value: { base: 'USD', quote: 'XTS', period: '1W' },
  })));
  await page.addInitScript(() => {
    window.__fexDelayedOpenPending = 0;
    const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess');
    if (!descriptor?.get || !descriptor.set) return;
    Object.defineProperty(IDBRequest.prototype, 'onsuccess', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(handler) {
        if (!(this instanceof IDBOpenDBRequest) || typeof handler !== 'function') {
          descriptor.set.call(this, handler);
          return;
        }
        const request = this;
        descriptor.set.call(this, event => {
          window.__fexDelayedOpenPending += 1;
          setTimeout(() => {
            window.__fexDelayedOpenPending -= 1;
            handler.call(request, event);
          }, 750);
        });
      },
    });
  });

  await page.reload();
  await expect(page.locator('#convert-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fexDelayedOpenPending)).toBeGreaterThan(0);
  await page.locator('#chart-tab').click();
  await expect(page.locator('#chart-screen')).toBeVisible();
  await expect(page.locator('#chart-quote')).toHaveAccessibleName(/^Quote currency: XTS, Test Settlement Unit/);
  await expect(page.locator('[data-chart-period="1W"]')).toHaveAttribute('aria-pressed', 'true');
  await waitForHistory(page);
  expect(calls.historyRequests.at(-1)).toMatchObject({ base: 'USD', quote: 'XTS' });
});

test('a rapid hash change leaves the latest Convert route active', async ({ page }) => {
  let releaseImport;
  let importStarted;
  let importCompleted = false;
  const importRequestStarted = new Promise(resolve => { importStarted = resolve; });
  const holdImport = new Promise(resolve => { releaseImport = resolve; });
  const calls = await mockApi(page);
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await page.route('**/*.js', async route => {
    importStarted();
    await holdImport;
    await route.continue();
    importCompleted = true;
  });

  await page.evaluate(() => { location.hash = '#chart?base=USD&quote=VND&period=1W'; });
  await importRequestStarted;
  await page.evaluate(() => { location.hash = ''; });
  await expect(page.locator('#convert-screen')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('');
  releaseImport();
  await expect.poll(() => importCompleted).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#chart-screen')).toBeHidden();
  await expect(page.locator('#convert-tab')).toHaveAttribute('aria-pressed', 'true');
  expect(calls.history).toBe(0);
});

test('reopening a stale selected chart refreshes that period after reconnect', async ({ page, context }) => {
  await page.clock.install();
  let multiplier = 1;
  const calls = await mockApi(page, {
    historyForRequest: request => historyRows(request).map(point => ({ ...point, rate: Number(point.rate) * multiplier })),
  });
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  await expect.poll(() => hasSavedHistory(page)).toBe(true);
  expect(calls.history).toBe(1);

  await context.setOffline(true);
  await expect(page.locator('#chart-status')).toHaveAttribute('data-phase', 'offline');
  await page.clock.fastForward(60 * 60 * 1000 + 1);
  multiplier = 2;
  await context.setOffline(false);
  await expect.poll(() => calls.history).toBe(2);
  await expect.poll(() => calls.historyReplies).toBe(2);
  await expect(page.locator('#chart-status')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#chart-rate')).toContainText('52,000');
  expect(calls.historyRequests[1]).toMatchObject({
    base: calls.historyRequests[0].base,
    quote: calls.historyRequests[0].quote,
    from: calls.historyRequests[0].from,
    to: calls.historyRequests[0].to,
  });
});

test('chart point selection works with keyboard and pointer', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);

  const chart = page.locator('#history-chart');
  await expect(chart).toBeVisible();
  await chart.focus();
  await page.keyboard.press('Home');
  const first = await chart.getAttribute('data-chart-point');
  await page.keyboard.press('ArrowRight');
  const next = await chart.getAttribute('data-chart-point');
  await page.keyboard.press('End');
  const last = await chart.getAttribute('data-chart-point');
  expect(first).not.toBe(next);
  expect(next).not.toBe(last);
  await expect(page.locator('#chart-point-readout')).toBeVisible();

  const box = await chart.boundingBox();
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.5);
  await expect.poll(() => chart.getAttribute('data-chart-point')).not.toBe(last);
});

test('the chart draws one time for each loaded series', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  await expect(page.locator('#history-chart')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => performance.getEntriesByName('fex:chart-render').length)).toBe(1);
  await expect(page.locator('#chart-picker-options .picker-option')).toHaveCount(0);
  await page.locator('#chart-quote').click();
  await expect(page.locator('#chart-picker-options .picker-option')).toHaveCount(catalog.length);
});

test('empty historical response has a clear state', async ({ page }) => {
  await mockApi(page, { historyForRequest: () => [] });
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  await expect(page.locator('#chart-empty')).toBeVisible();
  await expect(page.locator('#history-chart')).toBeHidden();
});

test('one-point historical response reports the unavailable change', async ({ page }) => {
  await mockApi(page, { historyForRequest: request => [{ base: request.base, quote: request.quote, date: request.to, rate: values[request.quote] ?? 1 }] });
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  await expect(page.locator('#history-chart')).toBeVisible();
  await expect(page.locator('#chart-change')).toContainText(/two|2|one observation/i);
  expect(await page.locator('#history-chart').getAttribute('data-chart-point')).toBeTruthy();
  await expect(page.locator('#chart-point-readout')).toBeVisible();
});

test('flat historical response draws a visible line and reports unchanged', async ({ page }) => {
  await mockApi(page, {
    historyForRequest: request => historyRows(request).map(row => ({ ...row, rate: values[request.quote] ?? 1 })),
  });
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  await expect(page.locator('#chart-change')).toContainText(/unchanged/i);
  await expect(page.locator('#history-chart')).toBeVisible();
  const markup = await page.locator('#history-chart').innerHTML();
  expect(markup).not.toMatch(/NaN|Infinity/);
});

test('reports an uncached history error and an offline state without saved history', async ({ page, context }) => {
  const calls = await mockApi(page, { historyStatus: 503 });
  await page.goto('/');
  await openChart(page);
  await expect(page.locator('#chart-status')).toHaveAttribute('data-phase', 'error');
  await expect(page.locator('#chart-retry')).toBeVisible();
  expect(calls.history).toBe(1);

  await page.locator('#convert-tab').click();
  await expect(page.locator('#convert-screen')).toBeVisible();
  await context.setOffline(true);
  await openChart(page);
  await expect(page.locator('#chart-status')).toHaveAttribute('data-phase', 'offline');
  expect(calls.history).toBe(1);
});

test('keeps saved points visible when a stale history refresh fails', async ({ page }) => {
  await page.clock.install();
  let historyStatus = 200;
  const calls = await mockApi(page, { historyStatus: () => historyStatus });
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  await expect.poll(() => hasSavedHistory(page)).toBe(true);

  historyStatus = 503;
  await page.clock.fastForward(60 * 60 * 1000 + 1000);
  await page.locator('#convert-tab').click();
  await page.locator('#chart-tab').click();
  await expect(page.locator('#chart-status')).toHaveAttribute('data-phase', 'error');
  await expect(page.locator('#chart-status-primary')).toContainText(/using saved history/i);
  await expect(page.locator('#history-chart')).toBeVisible();
  expect(calls.history).toBe(2);
});

test('a late response cannot replace the newly selected period', async ({ page }) => {
  let releaseFirst;
  let firstStarted;
  const firstRequestStarted = new Promise(resolve => { firstStarted = resolve; });
  const holdFirstResponse = new Promise(resolve => { releaseFirst = resolve; });
  let historyCount = 0;
  await page.route('https://api.frankfurter.dev/v2/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/currencies')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) });
      return;
    }
    if (url.searchParams.has('from')) {
      historyCount++;
      const request = { base: url.searchParams.get('base'), quote: url.searchParams.get('quotes'), from: url.searchParams.get('from'), to: url.searchParams.get('to') };
      if (historyCount === 1) {
        firstStarted();
        await holdFirstResponse;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(historyRows(request).map(row => ({ ...row, rate: 99999 }))) }).catch(() => {});
      } else {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(historyRows(request)) });
      }
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(rateRows()) });
  });

  await page.goto('/');
  await openChart(page);
  await firstRequestStarted;
  await selectPeriod(page, '1W');
  await waitForHistory(page);
  const selectedRate = await page.locator('#chart-rate').innerText();
  releaseFirst();
  await expect(page.locator('[data-chart-period="1W"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#chart-rate')).toHaveText(selectedRate);
  await expect.poll(() => historyCount).toBe(2);
});

test('history screen fits a 320 pixel viewport', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await openChart(page);
  await waitForHistory(page);
  const chart = page.locator('#history-chart');
  await expect(chart).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const matchesViewBoxWidth = () => chart.evaluate(node => {
    const renderedWidth = node.getBoundingClientRect().width;
    const viewBoxWidth = Number(node.getAttribute('viewBox')?.trim().split(/\s+/)[2]);
    return renderedWidth > 0 && Number.isFinite(viewBoxWidth)
      && Math.abs(viewBoxWidth - renderedWidth) / renderedWidth <= 0.05;
  });
  const fitsPlot = () => page.locator('#chart-plot').evaluate(plot => {
    const svg = plot.querySelector('#history-chart');
    const svgRect = svg.getBoundingClientRect(), plotRect = plot.getBoundingClientRect();
    const dateLabels = svg.querySelectorAll('.chart-date-label');
    const dateRect = dateLabels[dateLabels.length - 1].getBoundingClientRect();
    return svgRect.width <= plot.clientWidth + 2 && svgRect.height <= plot.clientHeight + 2
      && dateRect.left >= plotRect.left - 2 && dateRect.right <= plotRect.right + 2
      && dateRect.top >= plotRect.top - 2 && dateRect.bottom <= plotRect.bottom + 2;
  });
  await expect.poll(matchesViewBoxWidth, { message: 'The SVG viewBox width should match the rendered width after resize' }).toBe(true);
  await expect.poll(fitsPlot, { message: 'The chart and bottom date label should fit within the plot' }).toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(matchesViewBoxWidth, { message: 'The SVG viewBox should update to the desktop width' }).toBe(true);
  await expect.poll(fitsPlot, { message: 'The chart and bottom date label should fit within the desktop plot' }).toBe(true);
});

test('returning from Chart restores the converter scroll position', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  const savedScroll = await page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    return window.scrollY;
  });
  expect(savedScroll).toBeGreaterThan(0);

  await page.locator('#chart-tab').evaluate(button => button.click());
  await expect(page.locator('#chart-screen')).toBeVisible();
  await waitForHistory(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.locator('#convert-tab').evaluate(button => button.click());
  await expect(page.locator('#convert-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(savedScroll);
});
