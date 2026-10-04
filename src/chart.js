import { formatHistoryDate, formatHistoryRate, getHistoryChange, getHistoryRange, HISTORY_PERIODS } from './history.js';
import { createHistoryController } from './history-data.js';
import { createCurrencyPicker } from './picker.js';
import { formatChecked, normalizeSearch } from './domain.js';
import { recordMeasure } from './measure.js';

const SVG = 'http://www.w3.org/2000/svg';
const LEFT = 52, RIGHT = 14, TOP = 26, BOTTOM = 35;
const SHORT_PERIODS = new Set(['1W', '1M', '3M']);
const $ = id => document.getElementById(id);

/** @typedef {{base:string,quote:string,period:string}} Selection */
/** @typedef {import('./data.js').Currency} Currency */
/** @typedef {import('./history.js').HistoryRecord} HistoryRecord */
/** @typedef {import('./history-data.js').HistoryState} HistoryState */

/** @param {Element} element @param {{[key:string]:string|number}} attributes */
function setAttributes(element, attributes) {
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** @param {string} name @param {{[key:string]:string|number}} [attributes] */
function svgElement(name, attributes = {}) {
  return setAttributes(document.createElementNS(SVG, name), attributes);
}

/** @param {{storage:ReturnType<typeof import('./storage.js').createStorage>,locale:string,renderBadge:(element:HTMLElement,code:string)=>void,catalog:Currency[],onSelectionChange:(selection:Selection)=>void}} options */
export function createChartScreen({ storage, locale, renderBadge, catalog: initialCatalog, onSelectionChange }) {
  const baseButton = /** @type {HTMLButtonElement} */ ($('chart-base'));
  const quoteButton = /** @type {HTMLButtonElement} */ ($('chart-quote'));
  const periodButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('button[data-chart-period]'));
  const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($('history-chart')));
  const chartGrid = svg.querySelector('.chart-grid');
  const chartLine = /** @type {SVGPathElement} */ (svg.querySelector('.chart-line'));
  const chartLabels = svg.querySelector('.chart-labels');
  const chartTitle = $('history-chart-title');
  const chartDescription = $('history-chart-description');
  const chartEmpty = $('chart-empty');
  const pointReadout = $('chart-point-readout');
  const selectionAnnouncer = $('chart-selection-announcer');
  const rateLabel = $('chart-rate');
  const rateDateLabel = $('chart-rate-date');
  const changeLabel = $('chart-change');
  const rangeLabel = $('chart-range');
  const content = $('chart-content');
  const status = $('chart-status');
  const statusPrimary = $('chart-status-primary');
  const statusSecondary = $('chart-status-secondary');
  const retry = $('chart-retry');
  const pickerDialog = /** @type {HTMLDialogElement} */ ($('chart-picker'));
  const pickerOptions = $('chart-picker-options');
  const search = /** @type {HTMLInputElement} */ ($('chart-currency-search'));
  const searchClear = $('chart-search-clear');

  // One line and one point show the selection. Move them. Do not make new ones.
  const selectionLine = svgElement('line', { class: 'chart-selection-line' });
  const selectionPoint = svgElement('circle', { r: 5, class: 'chart-selection-point' });
  svg.querySelector('.chart-selection').append(selectionLine, selectionPoint);

  const changeFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
  const axisFormat = new Intl.NumberFormat(locale, { notation: 'compact', maximumSignificantDigits: 3 });
  const picker = createCurrencyPicker({ container: pickerOptions, renderBadge, mode: 'single' });
  /** @type {Map<string,Currency>} */ let catalog = new Map();
  /** @type {Selection} */ let selection = { base: 'USD', quote: 'VND', period: '1M' };
  let active = false, pickerSide = 'base', pickerStale = true, selectedIndex = -1;
  /** @type {HistoryRecord['points']} */ let points = [];
  /** @type {{x:number,y:number}[]} */ let coordinates = [];
  /** @type {HistoryRecord|null} */ let renderedRecord = null;
  let chartWidth = 0, chartHeight = 0, plotWidth = 0, plotHeight = 0;

  const history = createHistoryController({ storage, onChange: state => { if (active) renderState(state); } });

  const dateText = (date, options) => formatHistoryDate({ date, locale, options });
  const rateText = rate => formatHistoryRate({ rate, locale });
  const currency = code => catalog.get(code) || { code, name: code, symbol: code };
  const validSelection = ({ base, quote, period }) => base !== quote && HISTORY_PERIODS.includes(period) && catalog.has(base) && catalog.has(quote);

  function renderPair() {
    const base = currency(selection.base), quote = currency(selection.quote);
    baseButton.querySelector('.chart-currency-code').textContent = base.code;
    baseButton.querySelector('.chart-currency-name').textContent = base.name;
    quoteButton.querySelector('.chart-currency-code').textContent = quote.code;
    quoteButton.querySelector('.chart-currency-name').textContent = quote.name;
    baseButton.setAttribute('aria-label', `Base currency: ${base.code}, ${base.name}`);
    quoteButton.setAttribute('aria-label', `Quote currency: ${quote.code}, ${quote.name}`);
    chartTitle.textContent = `${base.code} to ${quote.code} history`;
    for (const button of periodButtons) button.setAttribute('aria-pressed', String(button.dataset.chartPeriod === selection.period));
  }

  function changeText(change) {
    if (!change) return 'Change needs at least two observations';
    if (change.direction === 'unchanged') return '0.00% unchanged';
    return `${changeFormat.format(Number(change.value))}% ${change.direction}`;
  }

  function rangeText(record) {
    const requested = getHistoryRange({ period: selection.period });
    const coverage = record.from > requested.from ? ` · Available from ${dateText(record.from)}`
      : record.to < requested.to ? ` · Available through ${dateText(record.to)}` : '';
    return `Observations ${dateText(points[0].date)} – ${dateText(points.at(-1).date)}${coverage} · ${formatChecked({ checkedAt: record.checkedAt })}`;
  }

  function showEmpty({ message = '' } = {}) {
    points = []; coordinates = []; selectedIndex = -1; renderedRecord = null;
    svg.setAttribute('hidden', '');
    svg.dataset.chartPoint = '';
    chartEmpty.textContent = message;
    chartEmpty.hidden = !message;
    pointReadout.hidden = true;
    pointReadout.textContent = ''; selectionAnnouncer.textContent = '';
    rateLabel.textContent = '—'; rateDateLabel.textContent = ''; rangeLabel.textContent = '';
    changeLabel.textContent = message ? 'No observations to compare' : 'Waiting for history';
  }

  // The axes show the requested range, even when the series is shorter.
  function buildAxes({ low, high, from, to }) {
    const grid = [], labels = [];
    for (let index = 0; index <= 4; index++) {
      const y = TOP + (index / 4) * plotHeight;
      const value = high - (index / 4) * (high - low);
      grid.push(svgElement('line', { x1: LEFT, y1: y, x2: chartWidth - RIGHT, y2: y, class: 'chart-grid-line' }));
      const label = svgElement('text', { x: LEFT - 9, y: y + 4, class: 'chart-axis-label', 'text-anchor': 'end' });
      label.textContent = value === 0 ? '0' : axisFormat.format(value);
      labels.push(label);
    }
    const middle = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString().slice(0, 10);
    const dateOptions = SHORT_PERIODS.has(selection.period) ? { month: 'short', day: 'numeric' } : { month: 'short', year: '2-digit' };
    [from, middle, to].forEach((date, index) => {
      const label = svgElement('text', { x: LEFT + (index / 2) * plotWidth, y: chartHeight - 10, class: 'chart-axis-label chart-date-label', 'text-anchor': ['start', 'middle', 'end'][index] });
      label.textContent = dateText(date, dateOptions);
      labels.push(label);
    });
    const unit = svgElement('text', { x: LEFT, y: 15, class: 'chart-axis-unit', 'text-anchor': 'start' });
    unit.textContent = selection.quote;
    labels.push(unit);
    chartGrid.replaceChildren(...grid);
    chartLabels.replaceChildren(...labels);
  }

  function select({ index, announce = false }) {
    if (!points.length) return;
    selectedIndex = Math.max(0, Math.min(points.length - 1, index));
    const point = points[selectedIndex], { x, y } = coordinates[selectedIndex];
    setAttributes(selectionLine, { x1: x, y1: TOP, x2: x, y2: TOP + plotHeight });
    setAttributes(selectionPoint, { cx: x, cy: y });
    svg.dataset.chartPoint = String(selectedIndex);
    pointReadout.textContent = `${dateText(point.date)} · 1 ${selection.base} = ${rateText(point.rate)} ${selection.quote}`;
    pointReadout.hidden = false;
    if (announce) selectionAnnouncer.textContent = pointReadout.textContent;
  }

  /** @param {HistoryRecord} record A record with one point or more. */
  function renderChart(record) {
    const start = performance.now();
    const selectedDate = points[selectedIndex]?.date;
    points = record.points;
    renderedRecord = record;
    chartEmpty.hidden = true;
    svg.removeAttribute('hidden');
    const rect = svg.getBoundingClientRect();
    chartWidth = Math.max(1, Math.round(rect.width || 640));
    chartHeight = Math.max(1, Math.round(rect.height || 280));
    plotWidth = Math.max(1, chartWidth - LEFT - RIGHT);
    plotHeight = Math.max(1, chartHeight - TOP - BOTTOM);
    svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`);

    const rates = points.map(point => Number(point.rate));
    let min = Infinity, max = -Infinity;
    for (const rate of rates) { if (rate < min) min = rate; if (rate > max) max = rate; }
    // The value axis does not start at zero. A flat series gets a range around its value.
    const padding = max > min ? (max - min) * 0.12 : max * 0.05;
    const low = Math.max(0, min - padding), high = max + padding;
    const { from, to } = getHistoryRange({ period: selection.period });
    buildAxes({ low, high, from, to });
    const fromTime = Date.parse(from), timeSpan = Math.max(1, Date.parse(to) - fromTime), valueSpan = high - low || 1;
    coordinates = points.map((point, index) => ({
      x: LEFT + ((Date.parse(point.date) - fromTime) / timeSpan) * plotWidth,
      y: TOP + ((high - rates[index]) / valueSpan) * plotHeight,
    }));
    chartLine.setAttribute('d', coordinates.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' '));
    chartLine.dataset.flat = String(max === min);

    const last = points.at(-1);
    rateLabel.textContent = `1 ${selection.base} = ${rateText(last.rate)} ${selection.quote}`;
    rateDateLabel.textContent = `Latest observation · ${dateText(last.date)}`;
    changeLabel.textContent = changeText(getHistoryChange({ points }));
    rangeLabel.textContent = rangeText(record);
    chartDescription.textContent = `${points.length} daily observations for one ${selection.base} in ${selection.quote}, from ${dateText(points[0].date)} to ${dateText(last.date)}. Use the left and right arrow keys to inspect each point.`;
    // Keep the selected date across a refresh. A new series selects its last point.
    const retained = selectedDate ? points.findIndex(point => point.date === selectedDate) : -1;
    select({ index: retained >= 0 ? retained : points.length - 1 });
    recordMeasure({ name: 'fex:chart-render', start });
  }

  function statusText({ phase, record, refreshing }) {
    if (phase === 'offline') return record ? 'Offline · using saved history' : 'Connect to view this period’s history.';
    if (phase === 'error') return record ? 'Could not update · using saved history' : 'History could not be loaded.';
    if (refreshing) return 'Checking for updates…';
    if (phase === 'loading') return `Loading ${selection.period} history…`;
    if (phase === 'idle') return 'Choose a period to view its history.';
    return 'Daily reference rates from Frankfurter';
  }

  /** @param {HistoryState} state */
  function renderState(state) {
    const { phase, record, error, refreshing } = state;
    const pair = `${selection.base} to ${selection.quote}`;
    status.dataset.phase = phase;
    content.setAttribute('aria-busy', String(phase === 'loading' || refreshing));
    retry.hidden = phase !== 'error' || !navigator.onLine;
    statusPrimary.textContent = statusText(state);
    statusSecondary.textContent = error || (record ? formatChecked({ checkedAt: record.checkedAt }) : 'The chart uses one unit of the base currency.');
    if (record?.points.length) renderChart(record);
    else if (record) showEmpty({ message: `No history is available for ${pair} in this period.` });
    else if (phase === 'offline') showEmpty({ message: `Connect to view ${pair} history for ${selection.period}.` });
    else if (phase === 'error') showEmpty({ message: `History for ${pair} could not be loaded. Try again when you are online.` });
    else showEmpty();
  }

  function requestHistory({ online = navigator.onLine, force = false } = {}) {
    if (!active) return Promise.resolve(history.getState());
    return history.load({ ...selection, online, force });
  }

  function filterPicker() {
    const query = normalizeSearch(search.value);
    const selected = new Set([pickerSide === 'base' ? selection.base : selection.quote]);
    const visible = picker.render({ search: query, codes: [], selected, rates: null });
    $('chart-picker-count').textContent = `${visible} ${visible === 1 ? 'currency' : 'currencies'}`;
    $('chart-picker-empty').hidden = visible !== 0;
    searchClear.hidden = !query;
  }

  // Build the 166 picker rows when the picker first opens, not when the chart opens.
  function syncPicker() {
    if (pickerStale) picker.setCatalog([...catalog.values()]);
    pickerStale = false;
    filterPicker();
  }

  function openPicker(side) {
    pickerSide = side;
    search.value = '';
    syncPicker();
    if (!pickerDialog.open) pickerDialog.showModal();
    search.focus();
  }

  /** @param {Selection} next */
  function updateSelection(next) {
    const same = next.base === selection.base && next.quote === selection.quote && next.period === selection.period;
    if (same || !validSelection(next)) return;
    selection = next;
    renderPair();
    onSelectionChange({ ...selection });
    void requestHistory();
  }

  // The two currencies must be different. A choice of the opposite currency swaps the pair.
  function chooseCurrency(code) {
    const other = pickerSide === 'base' ? 'quote' : 'base';
    const next = code === selection[other]
      ? { ...selection, base: selection.quote, quote: selection.base }
      : { ...selection, [pickerSide]: code };
    pickerDialog.close();
    updateSelection(next);
  }

  function selectNearest(event) {
    const rect = svg.getBoundingClientRect();
    if (!points.length || !rect.width) return;
    const x = Math.max(LEFT, Math.min(chartWidth - RIGHT, ((event.clientX - rect.left) / rect.width) * chartWidth));
    let low = 0, high = coordinates.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (coordinates[middle].x < x) low = middle + 1; else high = middle;
    }
    const index = low > 0 && x - coordinates[low - 1].x <= coordinates[low].x - x ? low - 1 : low;
    if (index !== selectedIndex) select({ index });
  }

  baseButton.addEventListener('click', () => openPicker('base'));
  quoteButton.addEventListener('click', () => openPicker('quote'));
  $('chart-swap').addEventListener('click', () => updateSelection({ ...selection, base: selection.quote, quote: selection.base }));
  $('chart-periods').addEventListener('click', event => {
    const period = /** @type {HTMLElement} */ (event.target).closest('button')?.dataset.chartPeriod;
    if (period) updateSelection({ ...selection, period });
  });
  // The selected radio sends no change event, so a click makes the choice. A click on a row also clicks its radio.
  pickerOptions.addEventListener('click', event => {
    if (event.target instanceof HTMLInputElement) chooseCurrency(event.target.value);
  });
  search.addEventListener('input', filterPicker);
  searchClear.addEventListener('click', () => { search.value = ''; filterPicker(); search.focus(); });
  retry.addEventListener('click', () => { void requestHistory({ force: true }); });
  svg.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') selectNearest(event); });
  svg.addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse') selectNearest(event); });
  svg.addEventListener('keydown', event => {
    if (!points.length) return;
    const steps = new Map([['ArrowLeft', selectedIndex - 1], ['ArrowRight', selectedIndex + 1], ['Home', 0], ['End', points.length - 1]]);
    if (!steps.has(event.key)) return;
    event.preventDefault();
    select({ index: steps.get(event.key), announce: true });
  });
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    const resized = Math.round(width) !== chartWidth || Math.round(height) !== chartHeight;
    if (active && renderedRecord && width && resized) renderChart(renderedRecord);
  }).observe(svg);

  /** @param {Currency[]} items */
  function setCatalog(items) {
    const next = new Map(items.map(item => [item.code, item]));
    // Keep the selected pair if the provider removes a code from its catalog.
    for (const code of [selection.base, selection.quote]) if (!next.has(code)) next.set(code, catalog.get(code) || { code, name: `${code} (saved currency)`, symbol: code });
    catalog = next;
    pickerStale = true;
    renderPair();
    if (pickerDialog.open) syncPicker();
  }

  function close() {
    active = false;
    history.deactivate();
  }

  /** Show a pair and period. The promise resolves when the series is on the screen or the load stops.
   * @param {Selection & {online?:boolean}} options */
  function open({ base, quote, period, online = navigator.onLine }) {
    close();
    if (validSelection({ base, quote, period })) selection = { base, quote, period };
    renderPair();
    active = true;
    return requestHistory({ online });
  }

  setCatalog(initialCatalog);
  return { open, close, setCatalog, refresh: ({ online = navigator.onLine } = {}) => requestHistory({ online }) };
}
