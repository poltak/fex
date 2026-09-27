import { FALLBACK_CATALOG } from '../../src/catalog.js';

export const day = new Date().toISOString().slice(0, 10);
export const values = { USD: 1, VND: 26000, EUR: 0.9, GBP: 0.75, AUD: 1.5, SGD: 1.3, THB: 34, IDR: 15000, JPY: 150 };
export const catalog = FALLBACK_CATALOG.map(item => ({ iso_code: item.code, name: item.name, symbol: item.symbol }));
export function rateRows({ multiplier = 1, omit = [] } = {}) {
  return FALLBACK_CATALOG.filter(item => !omit.includes(item.code)).map((item, index) => ({ base: 'USD', quote: item.code, rate: item.code === 'USD' ? 1 : (values[item.code] ?? (1 + index / 10)) * multiplier, date: day }));
}
export function historyRows({ base = 'USD', quote = 'VND', from, to, pointCount = 3 } = {}) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const count = Math.min(Math.max(1, pointCount), Math.floor((end - start) / 86400000) + 1);
  const dates = Array.from({ length: count }, (_, index) => count === 1 ? start : Math.round(start + (end - start) * index / (count - 1)));
  const latest = values[quote] ?? 1;
  return dates.map((time, index) => ({
    base,
    quote,
    date: new Date(time).toISOString().slice(0, 10),
    rate: count === 1 ? latest : latest * (0.97 + 0.03 * index / (count - 1)),
  }));
}

export async function mockApi(page, { multiplier = 1, omit = [], status = 200, catalogRows = catalog, historyStatus = 200, historyForRequest = historyRows } = {}) {
  const calls = { rates: 0, catalog: 0, history: 0, historyReplies: 0, historyRequests: [] };
  await page.route('https://api.frankfurter.dev/v2/**', async route => {
    const url = new URL(route.request().url());
    const isCatalog = url.pathname.endsWith('/currencies');
    const isHistory = url.searchParams.has('from') || url.searchParams.has('to') || url.searchParams.has('quotes');
    if (isHistory) {
      const request = {
        base: url.searchParams.get('base') || 'USD',
        quote: url.searchParams.get('quotes') || 'VND',
        from: url.searchParams.get('from') || '',
        to: url.searchParams.get('to') || '',
      };
      calls.history++;
      calls.historyRequests.push(request);
      const responseStatus = typeof historyStatus === 'function' ? historyStatus(request, calls) : historyStatus;
      await route.fulfill({ status: responseStatus, contentType: 'application/json', body: JSON.stringify(historyForRequest(request)) });
      calls.historyReplies++;
      return;
    }
    calls[isCatalog ? 'catalog' : 'rates']++;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(isCatalog ? catalogRows : rateRows({ multiplier, omit })) });
  });
  return calls;
}

export const amount = (page, code) => page.getByRole('textbox', { name: new RegExp(`^${code} amount`) });

export async function openManage(page) {
  await page.getByRole('button', { name: 'Open app menu' }).click();
  await page.getByRole('button', { name: /Manage currencies/ }).click();
}
