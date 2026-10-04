import { test, expect } from '@playwright/test';
import { FALLBACK_CATALOG } from '../../src/catalog.js';
import { amount, mockApi, openManage, rateRows, catalog, savedKeys } from './fixtures.js';

// These tests use deterministic API routes. An active worker can route a fetch
// outside page.route in WebKit. Real worker behavior has separate PWA tests.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('edits any currency instantly without requests or replacing the input', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().includes('frankfurter')) requests.push(request.url()); });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  const before = requests.length;
  await amount(page, 'USD').focus();
  await amount(page, 'USD').fill('100');
  await expect(amount(page, 'EUR')).toHaveValue('90.00');
  await expect(amount(page, 'VND')).toHaveValue('2,600,000');
  await amount(page, 'USD').evaluate(node => { window.__testInput = node; node.setSelectionRange(1, 1); });
  await page.keyboard.type('2');
  await expect(amount(page, 'USD')).toHaveValue('1200');
  expect(await amount(page, 'USD').evaluate(node => window.__testInput === node && node.selectionStart === 2)).toBe(true);
  await amount(page, 'EUR').click();
  await amount(page, 'EUR').fill('90');
  await expect(amount(page, 'USD')).toHaveValue('100.00');
  expect(requests.length).toBe(before);
  await amount(page, 'EUR').press('Enter');
  await page.reload();
  await expect(amount(page, 'EUR')).toHaveValue('90.00');
  await expect(page.locator('[data-code="EUR"].currency-card')).toHaveAttribute('data-source', 'true');
});

test('keeps precision across source selection and exposes tiny nonzero rates', async ({ page }) => {
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await amount(page, 'USD').fill('10.123456');
  for (const code of ['EUR', 'VND', 'GBP', 'USD']) await amount(page, code).focus();
  expect(Number(await amount(page, 'USD').inputValue())).toBeCloseTo(10.123456, 10);
  await amount(page, 'VND').fill('1');
  await expect(amount(page, 'USD')).toHaveValue('<0.01');
  await expect(page.locator('[data-code="USD"] .unit-rate')).not.toContainText('0.0000 USD');
});

test('distinguishes empty, zero, incomplete, and invalid input', async ({ page }) => {
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await amount(page, 'USD').fill('');
  await expect(amount(page, 'EUR')).toHaveValue('');
  await amount(page, 'USD').fill('0');
  await expect(amount(page, 'EUR')).toHaveValue('0.00');
  await amount(page, 'USD').fill('10.');
  await expect(amount(page, 'EUR')).toHaveValue('');
  await amount(page, 'USD').press('Enter');
  await page.reload();
  await expect(amount(page, 'USD')).toHaveValue('10.');
  await amount(page, 'USD').fill('-1');
  await expect(page.getByText('Enter zero or a positive amount.')).toBeVisible();
  await expect(amount(page, 'EUR')).toHaveValue('');
  await amount(page, 'USD').fill('1,234.5');
  await expect(amount(page, 'EUR')).toHaveValue('1,111.05');
});

test('searches the full catalog, restores sort order, and adds multiple currencies', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Add currency/ }).click();
  const picker = page.getByRole('dialog', { name: 'Add currencies' });
  await expect(picker.getByRole('checkbox')).toHaveCount(FALLBACK_CATALOG.length);
  await expect(picker.getByRole('checkbox', { name: /^Add USD/ })).toBeDisabled();
  const first = await page.locator('.picker-option').first().innerText();
  await page.getByRole('searchbox').fill('usd');
  await page.getByRole('button', { name: 'Clear search' }).click();
  expect(await page.locator('.picker-option').first().innerText()).toBe(first);
  await page.getByRole('searchbox').fill('dong');
  await expect(picker.getByRole('checkbox', { name: /^Add VND/ })).toBeVisible();
  await page.getByRole('searchbox').fill('JPY');
  await picker.getByRole('checkbox', { name: /^Add JPY/ }).check();
  await page.getByRole('searchbox').fill('cad');
  await picker.getByRole('checkbox', { name: /^Add CAD/ }).check();
  await picker.getByRole('button', { name: 'Add 2 currencies' }).click();
  await expect(page.locator('.currency-card')).toHaveCount(10);
  expect(await page.locator('.currency-card').evaluateAll(nodes => nodes.slice(-2).map(node => node.dataset.code))).toEqual(['JPY', 'CAD']);
  await expect(amount(page, 'JPY')).toHaveValue('1,500');
});

test('manages source removal, usable modal Undo, and keyboard focus', async ({ page }) => {
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await openManage(page);
  await page.getByRole('button', { name: 'Move USD up' }).click();
  expect(await page.locator('.currency-card').first().getAttribute('data-code')).toBe('USD');
  expect(await page.evaluate(() => document.activeElement.tagName === 'BUTTON' && !document.activeElement.disabled && document.activeElement.closest('#manage') !== null)).toBe(true);
  await page.getByRole('button', { name: 'Remove USD' }).click();
  await expect(page.locator('.currency-card')).toHaveCount(7);
  await expect(page.getByRole('dialog', { name: 'Manage currencies' }).getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Manage currencies' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.currency-card')).toHaveCount(8);
  await expect(page.locator('.currency-card').first()).toHaveAttribute('data-code', 'USD');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(amount(page, 'USD')).toHaveValue('10.00');
});

test('a missing target is unavailable and never zero', async ({ page }) => {
  await mockApi(page, { omit: ['EUR'] });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await expect(amount(page, 'EUR')).toHaveValue('');
  await expect(page.locator('[data-code="EUR"] .unit-rate')).toHaveText('Rate unavailable');
});

test('restores an incomplete source draft after removal and Undo', async ({ page }) => {
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await amount(page, 'USD').fill('10.');
  await openManage(page);
  await page.getByRole('button', { name: 'Remove USD' }).click();
  const manage = page.getByRole('dialog', { name: 'Manage currencies' });
  await manage.getByRole('button', { name: 'Undo' }).click();
  await manage.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.currency-card[data-code="USD"]')).toHaveAttribute('data-source', 'true');
  await expect(amount(page, 'USD')).toHaveValue('10.');
  await expect(amount(page, 'EUR')).toHaveValue('');
  await amount(page, 'USD').fill('10.5');
  await expect(amount(page, 'EUR')).toHaveValue('9.45');
});

test('failed first load recovers through Retry', async ({ page }) => {
  await mockApi(page, { status: 503 });
  await page.goto('/');
  await expect(page.getByText('Rates could not be loaded')).toBeVisible();
  await mockApi(page);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(amount(page, 'VND')).toHaveValue('260,000');
});

test('recovers from corrupt preferences and blocked persistent storage', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fex:preferences:v1', '{not-json');
    Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });
  });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await expect(page.getByText('Changes may not be saved on this device.')).toBeVisible();
  await amount(page, 'USD').fill('20');
  await expect(amount(page, 'EUR')).toHaveValue('18.00');
});

test('refreshes when due and applies rates after an active edit', async ({ page }) => {
  await page.clock.install();
  let load = 0;
  await page.route('https://api.frankfurter.dev/v2/**', async route => {
    const metadata = route.request().url().includes('/currencies');
    if (!metadata) load++;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(metadata ? catalog : rateRows({ multiplier: load > 1 ? 2 : 1 })) });
  });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await amount(page, 'USD').fill('100');
  await page.clock.fastForward(59 * 60000);
  expect(load).toBe(1);
  await page.clock.fastForward(2 * 60000);
  await expect.poll(() => load).toBe(2);
  await expect(amount(page, 'EUR')).toHaveValue('90.00');
  await amount(page, 'USD').press('Enter');
  await expect(amount(page, 'EUR')).toHaveValue('180.00');
  await expect(amount(page, 'USD')).toHaveValue('100.00');
});

test('keeps Retry available when the window gets focus after a failed refresh', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await expect.poll(() => savedKeys(page)).toContain('rates');
  await mockApi(page, { status: 503 });
  await page.clock.fastForward(61 * 60000);
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(page.getByText('Could not update — using saved rates')).toBeVisible();
  await expect(retry).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await savedKeys(page);
  await expect(page.getByText('Could not update — using saved rates')).toBeVisible();
  await expect(retry).toBeVisible();
  await expect(page.locator('#rate-status')).toHaveAttribute('data-phase', 'error');
});

test('uses the saved catalog after a reload and does not request it again', async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await expect.poll(() => savedKeys(page)).toEqual(expect.arrayContaining(['catalog', 'rates']));
  expect(calls.catalog).toBe(1);
  await page.reload();
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await savedKeys(page);
  await page.waitForTimeout(250);
  expect(calls.catalog).toBe(1);
  expect(calls.rates).toBe(1);
});

test('fits a narrow phone, keeps picker keyboard access, and has no page errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await amount(page, 'USD').fill('999999999999999.123456789012');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /^Add/ }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add currencies' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^Add/ })).toBeFocused();
  expect(errors).toEqual([]);
});

test('keeps currency selection local and responds to another idle tab', async ({ page, context }) => {
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  const other = await context.newPage(); await mockApi(other); await other.goto('/');
  await expect(amount(other, 'VND')).toHaveValue('260,000');
  await page.getByRole('button', { name: /Add currency/ }).click();
  await amount(other, 'USD').fill('25');
  await amount(other, 'USD').press('Enter');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(amount(page, 'USD')).toHaveValue('25.00');
  await page.reload();
  await expect(amount(page, 'USD')).toHaveValue('25.00');
});

test('Undo keeps a newer amount received from another tab', async ({ page, context }) => {
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  const other = await context.newPage(); await mockApi(other); await other.goto('/');
  await expect(amount(other, 'VND')).toHaveValue('260,000');
  await openManage(page);
  await page.getByRole('button', { name: 'Remove EUR' }).click();
  await expect(other.locator('.currency-card')).toHaveCount(7);
  await amount(other, 'USD').fill('25');
  await amount(other, 'USD').press('Enter');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(amount(page, 'USD')).toHaveValue('25.00');
  await page.locator('#undo').click();
  await expect(amount(page, 'USD')).toHaveValue('25.00');
  await expect(amount(page, 'EUR')).toHaveValue('22.50');
});

test('typing updates values without rewriting unchanged card metadata', async ({ page }) => {
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await amount(page, 'USD').focus();
  await page.evaluate(() => {
    window.__cardMutations = [];
    new MutationObserver(records => window.__cardMutations.push(...records.map(record => record.attributeName)))
      .observe(document.querySelector('#currency-list'), { subtree: true, attributes: true });
  });
  await amount(page, 'USD').fill('12');
  await expect(amount(page, 'EUR')).toHaveValue('10.80');
  expect(await page.evaluate(() => window.__cardMutations)).toEqual([]);
});

test('a delayed catalog preserves picker focus and selected currencies', async ({ page }) => {
  let sendCatalog;
  const ready = new Promise(resolve => { sendCatalog = resolve; });
  await page.route('https://api.frankfurter.dev/v2/currencies', async route => {
    await ready;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog.map(item => item.iso_code === 'JPY' ? { ...item, name: 'AAA Japanese Yen (updated)' } : item)) });
  });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await page.getByRole('button', { name: /Add currency/ }).click();
  const yen = page.getByRole('checkbox', { name: /^Add JPY/ });
  await yen.check();
  await yen.focus();
  sendCatalog();
  await expect(page.getByText('AAA Japanese Yen (updated)', { exact: true })).toBeVisible();
  await expect(yen).toBeFocused();
  await expect(yen).toBeChecked();
  await yen.evaluate(node => { window.__pickerYen = node; });
  await page.locator('#picker-add').click();
  await expect(amount(page, 'JPY')).toHaveValue('1,500');
  await page.getByRole('button', { name: /Add currency/ }).click();
  await expect(yen).toBeDisabled();
  expect(await yen.evaluate(node => window.__pickerYen === node)).toBe(true);
  await expect(page.locator('#picker-add')).toBeDisabled();
});

test('loads network rates when IndexedDB never responds', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: { open: () => ({}) } });
  });
  await page.goto('/');
  await expect(amount(page, 'VND')).toHaveValue('260,000');
  await expect(page.getByText('Changes may not be saved on this device.')).toBeVisible();
  await amount(page, 'USD').fill('20');
  await expect(amount(page, 'EUR')).toHaveValue('18.00');
});

test.describe('localized numbers', () => {
  test.use({ locale: 'ar-EG-u-nu-arab' });
  test('edits local digits and keeps the fraction in the same digit system', async ({ page }) => {
    // macOS WebKit exposes only "ar" in navigator.language, losing the requested
    // region and numbering system. Keep this test's locale deterministic.
    await page.addInitScript(() => Object.defineProperty(navigator, 'language', { value: 'ar-EG-u-nu-arab' }));
    await page.goto('/');
    await expect(amount(page, 'USD')).toHaveValue('١٠٫٠٠');
    await amount(page, 'USD').focus();
    await expect(amount(page, 'USD')).toHaveValue('١٠');
    await amount(page, 'USD').fill('١٢٫٥');
    await expect(amount(page, 'EUR')).toHaveValue('١١٫٢٥');
    await amount(page, 'USD').press('Enter');
    await page.reload();
    await expect(amount(page, 'USD')).toHaveValue('١٢٫٥٠');
  });
});
