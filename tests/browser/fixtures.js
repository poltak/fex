import { FALLBACK_CATALOG } from '../../src/catalog.js';

export const day = new Date().toISOString().slice(0, 10);
export const values = { USD: 1, VND: 26000, EUR: 0.9, GBP: 0.75, AUD: 1.5, SGD: 1.3, THB: 34, IDR: 15000, JPY: 150 };
export const catalog = FALLBACK_CATALOG.map(item => ({ iso_code: item.code, name: item.name, symbol: item.symbol }));
export function rateRows({ multiplier = 1, omit = [] } = {}) {
  return FALLBACK_CATALOG.filter(item => !omit.includes(item.code)).map((item, index) => ({ base: 'USD', quote: item.code, rate: item.code === 'USD' ? 1 : (values[item.code] ?? (1 + index / 10)) * multiplier, date: day }));
}
export async function mockApi(page, { multiplier = 1, omit = [], status = 200 } = {}) {
  const calls = { rates: 0, catalog: 0 };
  await page.route('https://api.frankfurter.dev/v2/**', async route => {
    const isCatalog = route.request().url().includes('/currencies');
    calls[isCatalog ? 'catalog' : 'rates']++;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(isCatalog ? catalog : rateRows({ multiplier, omit })) });
  });
  return calls;
}

export const amount = (page, code) => page.getByRole('textbox', { name: new RegExp(`^${code} amount`) });

export async function openManage(page) {
  await page.getByRole('button', { name: 'Open app menu' }).click();
  await page.getByRole('button', { name: /Manage currencies/ }).click();
}
