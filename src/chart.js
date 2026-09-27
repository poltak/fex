import { HISTORY_PERIODS, formatHistoryDate, formatHistoryRate, getHistoryChange, getHistoryRange, sliceHistoryPoints } from './history.js';
import { createHistoryController } from './history-data.js';
import { createCurrencyPicker } from './picker.js';
import { normalizeSearch } from './domain.js';

const SVG = 'http://www.w3.org/2000/svg';
const LEFT = 52, RIGHT = 14, TOP = 26, BOTTOM = 35;
const $ = id => document.getElementById(id);

/** @typedef {{base:string,quote:string,period:string}} Selection */
/** @typedef {{date:string,rate:string}} Point */
/** @typedef {{base:string,quote:string,from:string,to:string,points:Point[],checkedAt:number,lastUsedAt:number}} HistoryRecord */

/** @param {string} name @param {{[key:string]:string|number}} attributes */
function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** @param {{storage:ReturnType<typeof import('./storage.js').createStorage>,locale:string,renderBadge:(element:HTMLElement,code:string)=>void,getCatalog:()=>import('./data.js').Currency[],onSelectionChange:(selection:Selection)=>void}} options */
export function createChartScreen({ storage, locale, renderBadge, getCatalog, onSelectionChange }) {
  const baseButton = /** @type {HTMLButtonElement} */ ($('chart-base'));
  const quoteButton = /** @type {HTMLButtonElement} */ ($('chart-quote'));
  const baseCode = /** @type {HTMLElement} */ (baseButton.querySelector('.chart-currency-code'));
  const quoteCode = /** @type {HTMLElement} */ (quoteButton.querySelector('.chart-currency-code'));
  const baseName = /** @type {HTMLElement} */ (baseButton.querySelector('.chart-currency-name'));
  const quoteName = /** @type {HTMLElement} */ (quoteButton.querySelector('.chart-currency-name'));
  const periodButtons = [.../** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('button[data-chart-period]'))];
  const svg = /** @type {SVGSVGElement} */ (document.querySelector('#history-chart'));
  const chartGrid = /** @type {SVGGElement} */ (svg.querySelector('.chart-grid'));
  const chartLine = /** @type {SVGPathElement} */ (svg.querySelector('.chart-line'));
  const chartSelection = /** @type {SVGGElement} */ (svg.querySelector('.chart-selection'));
  const chartLabels = /** @type {SVGGElement} */ (svg.querySelector('.chart-labels'));
  const chartEmpty = /** @type {HTMLElement} */ ($('chart-empty'));
  const pointReadout = /** @type {HTMLElement} */ ($('chart-point-readout'));
  const search = /** @type {HTMLInputElement} */ ($('chart-currency-search'));
  const pickerDialog = /** @type {HTMLDialogElement} */ ($('chart-picker'));
  const pickerOptions = /** @type {HTMLElement} */ ($('chart-picker-options'));
  const pickerCount = /** @type {HTMLElement} */ ($('chart-picker-count'));
  const pickerEmpty = /** @type {HTMLElement} */ ($('chart-picker-empty'));
  const searchClear = /** @type {HTMLButtonElement} */ ($('chart-search-clear'));
  const status = /** @type {HTMLElement} */ ($('chart-status'));
  const statusPrimary = /** @type {HTMLElement} */ ($('chart-status-primary'));
  const statusSecondary = /** @type {HTMLElement} */ ($('chart-status-secondary'));
  const retry = /** @type {HTMLButtonElement} */ ($('chart-retry'));
  const content = /** @type {HTMLElement} */ ($('chart-content'));
  const rangeLabel = /** @type {HTMLElement} */ ($('chart-range'));
  const changeLabel = /** @type {HTMLElement} */ ($('chart-change'));
  const rateLabel = /** @type {HTMLElement} */ ($('chart-rate'));
  const rateDateLabel = /** @type {HTMLElement} */ ($('chart-rate-date'));
  const chartTitle = /** @type {SVGTitleElement} */ (document.querySelector('#history-chart-title'));
  const chartDescription = /** @type {SVGDescElement} */ (document.querySelector('#history-chart-description'));
  const selectionAnnouncer = /** @type {HTMLElement} */ ($('chart-selection-announcer'));
  const catalog = new Map();
  const picker = createCurrencyPicker({ container: pickerOptions, renderBadge, mode: 'single' });
  let selection = /** @type {Selection} */ ({ base: 'USD', quote: 'VND', period: '1M' });
  let active = false, pickerSide = 'base', selectedIndex = -1;
  /** @type {Point[]} */ let points = [];
  /** @type {{x:number,y:number}[]} */ let coordinates = [];
  /** @type {HistoryRecord|null} */ let renderedRecord = null;
  let chartWidth = 640, chartHeight = 280, plotWidth = chartWidth - LEFT - RIGHT, plotHeight = chartHeight - TOP - BOTTOM;
  /** @type {{phase:'idle'|'loading'|'ready'|'offline'|'error',record:HistoryRecord|null,error:string|null,retryAt:number|null,refreshing:boolean}} */
  let latestState = { phase: 'idle', record: null, error: null, retryAt: null, refreshing: false };

  function finishOpen() {
    if (!firstState) return;
    const done = firstState;
    firstState = null;
    done();
  }

  const history = createHistoryController({
    storage,
    onChange: next => {
      if (!active) return;
      latestState = next;
      renderState(next);
      if (firstState && next.phase !== 'loading') finishOpen();
    },
  });
  /** @type {(()=>void)|null} */ let firstState = null;

  function item(code) { return catalog.get(code) || { code, name: code, symbol: code }; }
  function renderPair() {
    const base = item(selection.base), quote = item(selection.quote);
    baseCode.textContent = base.code; baseName.textContent = base.name;
    quoteCode.textContent = quote.code; quoteName.textContent = quote.name;
    baseButton.setAttribute('aria-label', `Base currency: ${base.code}, ${base.name}`);
    quoteButton.setAttribute('aria-label', `Quote currency: ${quote.code}, ${quote.name}`);
    chartTitle.textContent = `${base.code} to ${quote.code} history`;
    chartDescription.textContent = `Daily exchange rate observations for one ${base.code} in ${quote.code}. Use the left and right arrow keys to inspect each point.`;
  }

  function renderPeriods() {
    for (const button of periodButtons) button.setAttribute('aria-pressed', String(button.dataset.chartPeriod === selection.period));
  }

  function range() { return getHistoryRange({ period: selection.period }); }
  function dateText(date, options) { return formatHistoryDate({ date, locale, options }); }
  function rateText(rate) { return formatHistoryRate({ rate, locale }); }
  function axisRateText(value) {
    if (value === 0) return '0';
    try { return new Intl.NumberFormat(locale, { notation: 'compact', maximumSignificantDigits: 3 }).format(value); }
    catch { return rateText(value); }
  }

  function changeText(change) {
    if (!change) return 'Change needs at least two observations';
    if (change.direction === 'unchanged') return `0.00% ${change.direction}`;
    const value = Number(change.value);
    if (!Number.isFinite(value)) return `${change.value}% ${change.direction}`;
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always',
    }).format(value);
    return `${formatted}% ${change.direction}`;
  }

  function clearSeries() {
    points = []; coordinates = []; selectedIndex = -1;
    renderedRecord = null;
    svg.setAttribute('hidden', ''); svg.dataset.chartPoint = '';
    chartGrid.replaceChildren(); chartLine.setAttribute('d', ''); chartSelection.replaceChildren(); chartLabels.replaceChildren();
    chartEmpty.hidden = true; pointReadout.hidden = true; pointReadout.textContent = '';
    rateLabel.textContent = '—'; rateDateLabel.textContent = ''; changeLabel.textContent = 'Waiting for history';
    rangeLabel.textContent = ''; selectionAnnouncer.textContent = '';
  }

  function checkedText(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'Checked just now';
    if (minutes < 60) return `Checked ${minutes} min ago`;
    if (minutes < 1440) return `Checked ${Math.floor(minutes / 60)} hr ago`;
    return `Checked ${Math.floor(minutes / 1440)} days ago`;
  }

  function renderRange(record, currentPoints) {
    const requested = range();
    const first = currentPoints[0]?.date, last = currentPoints.at(-1)?.date;
    const span = first && last ? `Observations ${dateText(first)} – ${dateText(last)}` : 'No observation dates';
    const partial = record.from > requested.from || record.to < requested.to;
    const coverage = partial ? ` · Available ${record.from > requested.from ? `from ${dateText(record.from)}` : `through ${dateText(record.to)}`}` : '';
    rangeLabel.textContent = `${span}${coverage} · ${checkedText(record.checkedAt)}`;
  }

  function buildAxes({ low, high, requested }) {
    chartGrid.replaceChildren(); chartLabels.replaceChildren();
    for (let index = 0; index <= 4; index++) {
      const ratio = index / 4, y = TOP + ratio * plotHeight;
      const value = high - ratio * (high - low);
      chartGrid.append(svgElement('line', { x1: LEFT, y1: y, x2: chartWidth - RIGHT, y2: y, class: 'chart-grid-line' }));
      const label = svgElement('text', { x: LEFT - 9, y: y + 4, class: 'chart-axis-label', 'text-anchor': 'end' });
      label.textContent = axisRateText(value);
      chartLabels.append(label);
    }
    const fromTime = Date.parse(`${requested.from}T00:00:00.000Z`);
    const toTime = Date.parse(`${requested.to}T00:00:00.000Z`);
    const axisDates = [requested.from, new Date(fromTime + (toTime - fromTime) / 2).toISOString().slice(0, 10), requested.to];
    const dateOptions = selection.period === '1W' || selection.period === '1M' || selection.period === '3M'
      ? { month: 'short', day: 'numeric' } : { month: 'short', year: '2-digit' };
    axisDates.forEach((date, index) => {
      const x = LEFT + (index / 2) * plotWidth;
      const label = svgElement('text', { x, y: chartHeight - 10, class: 'chart-axis-label chart-date-label', 'text-anchor': index === 0 ? 'start' : index === 2 ? 'end' : 'middle' });
      label.textContent = dateText(date, dateOptions);
      chartLabels.append(label);
    });
    const unit = svgElement('text', { x: LEFT, y: 15, class: 'chart-axis-unit', 'text-anchor': 'start' });
    unit.textContent = selection.quote;
    chartLabels.append(unit);
    return { fromTime, toTime };
  }

  function drawSelection(index, { announce = false } = {}) {
    if (!points.length || !coordinates.length) return;
    selectedIndex = Math.max(0, Math.min(points.length - 1, index));
    const point = points[selectedIndex], location = coordinates[selectedIndex];
    chartSelection.replaceChildren(
      svgElement('line', { x1: location.x, y1: TOP, x2: location.x, y2: TOP + plotHeight, class: 'chart-selection-line' }),
      svgElement('circle', { cx: location.x, cy: location.y, r: 5, class: 'chart-selection-point' }),
    );
    svg.dataset.chartPoint = String(selectedIndex);
    pointReadout.textContent = `${dateText(point.date)} · 1 ${selection.base} = ${rateText(point.rate)} ${selection.quote}`;
    pointReadout.hidden = false;
    if (announce) selectionAnnouncer.textContent = pointReadout.textContent;
  }

  function renderChart(currentPoints, record) {
    const start = performance.now();
    const selectedDate = points[selectedIndex]?.date;
    svg.removeAttribute('hidden');
    const rect = svg.getBoundingClientRect();
    chartWidth = Math.max(1, Math.round(rect.width || svg.clientWidth || 640));
    chartHeight = Math.max(1, Math.round(rect.height || svg.clientHeight || 280));
    plotWidth = Math.max(1, chartWidth - LEFT - RIGHT);
    plotHeight = Math.max(1, chartHeight - TOP - BOTTOM);
    svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`);
    const numeric = currentPoints.map(point => Number(point.rate));
    const min = Math.min(...numeric), max = Math.max(...numeric);
    const spread = max - min;
    const padding = spread === 0 ? Math.max(Math.abs(max) * 0.05, Number.MIN_VALUE * 100) : spread * 0.12;
    let low = Math.max(0, min - padding), high = max + padding;
    if (!Number.isFinite(low)) low = min;
    if (!Number.isFinite(high)) high = max;
    if (low === high) { low = Math.max(0, min * 0.95); high = max * 1.05 || 1; }
    const { fromTime, toTime } = buildAxes({ low, high, requested: range() });
    const timeSpan = Math.max(1, toTime - fromTime), valueSpan = Math.max(Number.MIN_VALUE, high - low);
    coordinates = currentPoints.map((point, index) => {
      const time = Date.parse(`${point.date}T00:00:00.000Z`);
      const rate = numeric[index];
      return {
        x: LEFT + ((time - fromTime) / timeSpan) * plotWidth,
        y: TOP + ((high - rate) / valueSpan) * plotHeight,
      };
    });
    const path = coordinates.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    chartLine.setAttribute('d', path);
    chartLine.dataset.flat = String(spread === 0);
    chartSelection.replaceChildren();
    points = currentPoints;
    renderedRecord = record;
    svg.removeAttribute('hidden'); chartEmpty.hidden = true;
    rateLabel.textContent = `1 ${selection.base} = ${rateText(currentPoints.at(-1).rate)} ${selection.quote}`;
    rateDateLabel.textContent = `Latest observation · ${dateText(currentPoints.at(-1).date)}`;
    const change = getHistoryChange({ points: currentPoints });
    changeLabel.textContent = changeText(change);
    renderRange(record, currentPoints);
    chartDescription.textContent = `${currentPoints.length} daily observations for one ${selection.base} in ${selection.quote}, from ${dateText(currentPoints[0].date)} to ${dateText(currentPoints.at(-1).date)}. Use the left and right arrow keys to inspect each point.`;
    const retainedIndex = selectedDate ? currentPoints.findIndex(point => point.date === selectedDate) : -1;
    drawSelection(retainedIndex >= 0 ? retainedIndex : currentPoints.length - 1);
    performance.measure('fex:chart-render', { start, end: performance.now() });
    if (performance.getEntriesByName('fex:chart-render').length > 100) performance.clearMeasures('fex:chart-render');
  }

  function emptyMessage(message) {
    points = []; coordinates = []; selectedIndex = -1; renderedRecord = null;
    svg.setAttribute('hidden', ''); chartSelection.replaceChildren(); chartGrid.replaceChildren(); chartLabels.replaceChildren(); chartLine.setAttribute('d', '');
    chartEmpty.textContent = message; chartEmpty.hidden = false;
    pointReadout.textContent = ''; pointReadout.hidden = true; rateLabel.textContent = '—'; rateDateLabel.textContent = '';
    changeLabel.textContent = 'No observations to compare'; rangeLabel.textContent = '';
    svg.dataset.chartPoint = '';
  }

  function matchingPoints(record) {
    if (!record || record.base !== selection.base || record.quote !== selection.quote) return [];
    const requested = range();
    if (record.from > requested.to || record.to < requested.from) return [];
    return sliceHistoryPoints({ points: record.points, from: requested.from, to: requested.to });
  }

  function renderState(next) {
    const record = next.record && next.record.base === selection.base && next.record.quote === selection.quote ? next.record : null;
    const currentPoints = matchingPoints(record);
    const hasRecord = !!record;
    const online = navigator.onLine;
    status.dataset.phase = next.phase;
    content.setAttribute('aria-busy', String(next.phase === 'loading' || next.refreshing));
    retry.hidden = next.phase !== 'error' || !online;
    statusPrimary.textContent = next.phase === 'offline'
      ? hasRecord ? 'Offline · using saved history' : 'Connect to view this period’s history.'
      : next.phase === 'error'
        ? hasRecord ? 'Could not update · using saved history' : 'History could not be loaded.'
        : next.refreshing ? 'Checking for updates…'
          : next.phase === 'loading' ? `Loading ${selection.period} history…`
            : next.phase === 'idle' ? 'Choose a period to view its history.'
              : 'Daily reference rates from Frankfurter';
    statusSecondary.textContent = next.error || (hasRecord ? checkedText(record.checkedAt) : 'The chart uses one unit of the base currency.');
    if (record && currentPoints.length) renderChart(currentPoints, record);
    else if (record && record.points.length === 0) emptyMessage(`No history is available for ${selection.base} to ${selection.quote} in this period.`);
    else if (next.phase === 'offline') emptyMessage(`Connect to view ${selection.base} to ${selection.quote} history for ${selection.period}.`);
    else if (next.phase === 'error') emptyMessage(`History for ${selection.base} to ${selection.quote} could not be loaded. Try again when you are online.`);
    else {
      clearSeries();
      if (hasRecord && currentPoints.length === 0) emptyMessage(`No observations are available for ${selection.base} to ${selection.quote} in this period.`);
    }
  }

  function requestHistory({ online = navigator.onLine, force = false } = {}) {
    if (!active) return Promise.resolve(latestState);
    const requested = { ...selection };
    return history.load({ ...requested, online, force }).catch(error => {
      if (active && error?.name !== 'AbortError') {
        latestState = { phase: 'error', record: null, error: error?.message || 'History could not be loaded.', retryAt: null, refreshing: false };
        renderState(latestState);
        finishOpen();
      }
      return latestState;
    });
  }

  function openPicker(side) {
    pickerSide = side;
    search.value = '';
    picker.setCatalog(getCatalog());
    filterPicker();
    if (!pickerDialog.open) pickerDialog.showModal();
    search.focus();
  }

  function filterPicker() {
    const query = normalizeSearch(search.value);
    const visible = picker.render({ search: query, codes: [], selected: new Set([pickerSide === 'base' ? selection.base : selection.quote]), rates: null });
    pickerCount.textContent = `${visible} ${visible === 1 ? 'currency' : 'currencies'}`;
    pickerEmpty.hidden = visible !== 0;
    searchClear.hidden = !query;
  }

  function updateSelection(next, { notify = true, load = true } = {}) {
    if (!HISTORY_PERIODS.includes(next.period) || next.base === next.quote || !catalog.has(next.base) || !catalog.has(next.quote)) return;
    const changed = next.base !== selection.base || next.quote !== selection.quote || next.period !== selection.period;
    if (!changed) return;
    selection = { ...next };
    renderPair(); renderPeriods(); clearSeries();
    renderState({ phase: 'loading', record: null, error: null, retryAt: null, refreshing: false });
    if (notify) onSelectionChange({ ...selection });
    if (load && active) void requestHistory();
  }

  function chooseCurrency(code) {
    const next = { ...selection };
    if (pickerSide === 'base') {
      if (code === selection.quote) { next.base = selection.quote; next.quote = selection.base; }
      else next.base = code;
    } else if (code === selection.base) { next.base = selection.quote; next.quote = selection.base; }
    else next.quote = code;
    pickerDialog.close();
    updateSelection(next);
  }

  function selectNearest(event) {
    if (!points.length || !coordinates.length) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((event.clientX - rect.left) / rect.width) * chartWidth;
    const boundedX = Math.max(LEFT, Math.min(chartWidth - RIGHT, x));
    let low = 0, high = coordinates.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (coordinates[middle].x < boundedX) low = middle + 1; else high = middle;
    }
    const index = low > 0 && Math.abs(coordinates[low - 1].x - boundedX) <= Math.abs(coordinates[low].x - boundedX) ? low - 1 : low;
    drawSelection(index);
  }

  baseButton.addEventListener('click', () => openPicker('base'));
  quoteButton.addEventListener('click', () => openPicker('quote'));
  $('chart-swap').addEventListener('click', () => updateSelection({ ...selection, base: selection.quote, quote: selection.base }));
  $('chart-periods').addEventListener('click', event => {
    const button = /** @type {HTMLButtonElement|null} */ (event.target instanceof Element ? event.target.closest('[data-chart-period]') : null);
    if (button?.dataset.chartPeriod) updateSelection({ ...selection, period: button.dataset.chartPeriod });
  });
  pickerOptions.addEventListener('change', event => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.checked) chooseCurrency(input.value);
  });
  search.addEventListener('input', filterPicker);
  searchClear.addEventListener('click', () => { search.value = ''; filterPicker(); search.focus(); });
  retry.addEventListener('click', () => { void requestHistory({ force: true }); });
  svg.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') selectNearest(event); });
  svg.addEventListener('pointerdown', event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') selectNearest(event); });
  svg.addEventListener('keydown', event => {
    if (!points.length) return;
    let next = selectedIndex;
    if (event.key === 'ArrowLeft') next--;
    else if (event.key === 'ArrowRight') next++;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = points.length - 1;
    else return;
    event.preventDefault(); drawSelection(next, { announce: true });
  });
  const chartResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (active && renderedRecord && points.length) renderChart(points, renderedRecord);
  }) : null;
  chartResizeObserver?.observe(svg);

  function setCatalog(items) {
    const next = new Map(items.map(item => [item.code, item]));
    for (const code of [selection.base, selection.quote]) if (!next.has(code)) next.set(code, catalog.get(code) || { code, name: `${code} (saved currency)`, symbol: code });
    catalog.clear(); for (const [code, item] of next) catalog.set(code, item);
    picker.setCatalog([...catalog.values()]);
    renderPair();
    if (pickerDialog.open) filterPicker();
  }

  function open({ base, quote, period, online = navigator.onLine }) {
    active = false; finishOpen(); history.deactivate();
    if (!catalog.size) setCatalog(getCatalog());
    const candidate = { base, quote, period };
    if (candidate.base !== candidate.quote && HISTORY_PERIODS.includes(candidate.period) && catalog.has(candidate.base) && catalog.has(candidate.quote)) selection = candidate;
    renderPair(); renderPeriods(); clearSeries();
    active = true;
    /** @type {Promise<void>} */
    const ready = new Promise(resolve => {
      firstState = () => resolve();
      void requestHistory({ online });
    });
    return ready;
  }

  function refresh({ online = navigator.onLine } = {}) {
    if (!active) active = true;
    return requestHistory({ online });
  }

  function close() {
    active = false; finishOpen(); history.deactivate();
  }

  function focusHeading() { $('chart-heading').focus({ preventScroll: true }); }

  setCatalog(getCatalog());
  renderPair(); renderPeriods();
  return { open, close, refresh, setCatalog, focusHeading, getSelection: () => ({ ...selection }), destroy: () => { close(); history.destroy(); } };
}
