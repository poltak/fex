import { pathToFileURL } from 'node:url';
import { fetchCatalog, fetchRates } from '../src/data.js';
import { fetchHistory } from '../src/history-data.js';
import { DEFAULT_CODES } from '../src/catalog.js';

/** Read-only schema, coverage, and CORS check. It sends no entered amount. */
export async function smokeLive({ fetchImpl = fetch, origin = 'https://example.com', now = Date.now } = {}) {
  const parsedOrigin = new URL(origin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)) throw new Error('The smoke origin must use HTTP or HTTPS.');
  const requestOrigin = parsedOrigin.origin;
  const requests = [];
  const checkedFetch = async (url, options) => {
    const endpoint = new URL(url);
    const params = [...endpoint.searchParams.keys()];
    const currentRates = endpoint.pathname === '/v2/rates' && params.length === 1 && params[0] === 'base';
    const historyRates = endpoint.pathname === '/v2/rates'
      && params.length === 4
      && ['base', 'quotes', 'from', 'to'].every(key => endpoint.searchParams.getAll(key).length === 1);
    const catalogRequest = endpoint.pathname === '/v2/currencies' && params.length === 0;
    if (endpoint.origin !== 'https://api.frankfurter.dev' || !(catalogRequest || currentRates || historyRates)) throw new Error('Unexpected live check endpoint.');
    const response = await fetchImpl(url, { ...options, headers: { Origin: requestOrigin } });
    const allowOrigin = response.headers.get('access-control-allow-origin');
    requests.push({ endpoint: endpoint.href, status: response.status, allowOrigin });
    if (response.ok && allowOrigin !== '*' && allowOrigin !== requestOrigin) throw new Error(`CORS does not allow ${requestOrigin} on ${endpoint.pathname}.`);
    return response;
  };
  // The production adapters apply the existing catalog and rate validators.
  const today = new Date(now()).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const [catalog, snapshot, history] = await Promise.all([
    fetchCatalog({ fetchImpl: checkedFetch }),
    fetchRates({ fetchImpl: checkedFetch, now }),
    fetchHistory({ base: 'USD', quote: 'VND', from, to: today, fetchImpl: checkedFetch, now }),
  ]);
  const catalogCodes = new Set(catalog.map(item => item.code));
  const missingCatalog = DEFAULT_CODES.filter(code => !catalogCodes.has(code));
  const missingRates = DEFAULT_CODES.filter(code => !snapshot.rates[code]);
  if (missingCatalog.length || missingRates.length) throw new Error(`Initial list coverage failed: catalog [${missingCatalog.join(', ')}], rates [${missingRates.join(', ')}].`);
  if (history.points.length === 0) throw new Error(`The historical USD/VND check returned no observations from ${from} to ${today}.`);
  const dates = Object.entries(snapshot.rates).filter(([code]) => code !== 'USD').map(([, row]) => row.date).sort();
  return {
    checkedAt: new Date(snapshot.checkedAt).toISOString(),
    catalogCount: catalog.length,
    rateCountIncludingUsd: Object.keys(snapshot.rates).length,
    supportedDefaults: DEFAULT_CODES,
    rateDates: { oldest: dates[0], newest: dates.at(-1) },
    history: { pair: `${history.base}/${history.quote}`, requested: { from, to: today }, points: history.points.length, observations: { first: history.points[0].date, last: history.points.at(-1).date } },
    cors: { origin: requestOrigin, requests: requests.sort((a, b) => a.endpoint.localeCompare(b.endpoint)) },
    privacy: 'Only catalog, latest USD table, and selected USD/VND history GET requests were sent. No amount was transmitted.',
    scope: 'Response-header check in Node; deployed-browser and physical-device checks are separate.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await smokeLive({ origin: process.env.FEX_SMOKE_ORIGIN || 'https://example.com' });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Live API smoke failed: ${error.message}`);
    process.exitCode = 1;
  }
}
