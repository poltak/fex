import { test, expect } from '@playwright/test';
import { amount, mockApi } from './fixtures.js';
import { FALLBACK_CATALOG } from '../../src/catalog.js';
import { writeFile } from 'node:fs/promises';

const p95 = values => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * .95) - 1)];
async function reportMetrics({ testInfo, name, report }) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

test('@performance cold shell, warm offline opening, and visual captures', async ({ browser }, testInfo) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'en-US' });
  const page = await context.newPage();
  await mockApi(page);
  await page.addInitScript(() => {
    window.__layoutShift = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__layoutShift += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
  await page.locator('.currency-badge img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const cold = await page.evaluate(() => ({
    firstPaint: performance.getEntriesByName('first-contentful-paint')[0].startTime,
    controlsReady: performance.getEntriesByName('fex:controls-ready')[0].startTime,
    layoutShift: window.__layoutShift,
  }));
  expect(cold.firstPaint).toBeLessThan(1500);
  expect(cold.controlsReady).toBeLessThan(2000);
  expect(cold.layoutShift).toBeLessThanOrEqual(0.05);
  await page.screenshot({ path: testInfo.outputPath('fex-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: /^Add/ }).click();
  await page.screenshot({ path: testInfo.outputPath('fex-picker.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.unroute('https://api.frankfurter.dev/v2/**');
  await context.setOffline(true);
  const warm = [];
  for (let index = 0; index < 5; index++) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(amount(page, 'VND')).toHaveValue('260,000');
    warm.push(await page.evaluate(() => performance.getEntriesByName('fex:saved-rates-ready')[0].startTime));
  }
  const report = { profile: 'Chromium, 390x844, 4x CPU slowdown; cold: 1.6Mbps/150ms; warm: offline service worker', cold, warm, warmP95: p95(warm) };
  await reportMetrics({ testInfo, name: 'startup-metrics', report });
  expect(report.warmP95).toBeLessThan(500);
  await context.setOffline(false);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.screenshot({ path: testInfo.outputPath('fex-desktop.png'), fullPage: true });
  await context.close();
});

test('@performance input and search stay quick with eight and all currencies', async ({ page, context }, testInfo) => {
  const calls = await mockApi(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: false });
  });
  const before = calls.rates;
  await amount(page, 'USD').focus();
  for (let index = 1; index <= 20; index++) await amount(page, 'USD').fill(`${index}123.45`);
  const normal = await page.evaluate(() => performance.getEntriesByName('fex:amount-input').map(entry => entry.duration));
  expect(p95(normal)).toBeLessThan(50);
  await page.getByRole('button', { name: /Add currency/ }).click();
  const pickerOpen = await page.evaluate(() => performance.getEntriesByName('fex:picker-open').at(-1).duration);
  expect(pickerOpen).toBeLessThan(100);
  await page.evaluate(() => performance.clearMeasures('fex:picker-open'));
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Add currency/ }).click();
  }
  const pickerReopen = await page.evaluate(() => performance.getEntriesByName('fex:picker-open').map(entry => entry.duration));
  expect(p95(pickerReopen)).toBeLessThan(100);
  for (const search of ['dollar', 'eur', 'dong', 'pound', 'yen', 'd', 'do', 'dol', 'doll', '']) await page.getByRole('searchbox').fill(search);
  const filter = await page.evaluate(() => performance.getEntriesByName('fex:picker-search').map(entry => entry.duration));
  expect(p95(filter)).toBeLessThan(100);
  // Fill through real change events to measure the complete large-list path.
  await page.locator('.picker-option input:not(:disabled)').evaluateAll(inputs => { for (const input of inputs) { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.locator('#picker-add').click();
  await expect(page.locator('.currency-card')).toHaveCount(FALLBACK_CATALOG.length);
  await page.evaluate(() => { performance.clearMeasures('fex:amount-input'); window.__longTasks = []; });
  await amount(page, 'USD').focus();
  for (let index = 1; index <= 20; index++) await amount(page, 'USD').fill(`${index}.123456`);
  const large = await page.evaluate(() => ({ inputs: performance.getEntriesByName('fex:amount-input').map(entry => entry.duration), longTasks: window.__longTasks }));
  expect(p95(large.inputs)).toBeLessThan(100);
  expect(large.longTasks.filter(duration => duration > 50).length).toBeLessThan(2);
  expect(calls.rates).toBe(before);
  await reportMetrics({ testInfo, name: 'interaction-metrics', report: { cpuSlowdown: 4, defaultInputP95: p95(normal), pickerOpen, pickerReopenP95: p95(pickerReopen), searchP95: p95(filter), fullCatalogCount: FALLBACK_CATALOG.length, fullCatalogInputP95: p95(large.inputs), longTasks: large.longTasks } });
});
