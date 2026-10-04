import { createConverter, formatAmount, formatChecked, formatEditable, formatUnitRate, isOldRate, normalizeSearch, parseAmount, rateDates } from './domain.js';
import { DEFAULT_AMOUNT, DEFAULT_CODES, DEFAULT_SOURCE, FALLBACK_CATALOG } from './catalog.js';
import { createRateController, fetchCatalog, fetchRates, isFresh } from './data.js';
import { HISTORY_PERIODS } from './history.js';
import { createStorage } from './storage.js';
import { createPwa } from './pwa/client.js';
import { createCurrencyPicker } from './picker.js';
import { recordMeasure } from './measure.js';

/** @typedef {import('./data.js').Snapshot} Snapshot */
/** @typedef {import('./data.js').Currency} Currency */
/** @typedef {import('./storage.js').Preferences} Preferences */
/** @typedef {{base:string,quote:string,period:string}} ChartSettings */
/** @typedef {{element:HTMLElement,input:HTMLInputElement,badge:HTMLElement,code:HTMLElement,name:HTMLElement,unit:HTMLElement,error:HTMLElement,history:HTMLButtonElement,amount:string|null}} Row */

const locale = navigator.language || 'en-US';
const base = import.meta.env.BASE_URL;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const localBadges = new Set(DEFAULT_CODES);
const $ = id => document.getElementById(id);
const dialog = id => /** @type {HTMLDialogElement} */ ($(id));
const dom = {
  list: $('currency-list'), template: /** @type {HTMLTemplateElement} */ ($('card-template')),
  convertScreen: $('convert-screen'), chartScreen: $('chart-screen'),
  convertTab: $('convert-tab'), chartTab: $('chart-tab'),
  convertHeading: $('convert-heading'), chartHeading: $('chart-heading'),
  picker: dialog('picker'), manage: dialog('manage'), menu: dialog('menu'), about: dialog('about'), installHelp: dialog('install-help'),
  search: /** @type {HTMLInputElement} */ ($('currency-search')),
  pickerAdd: /** @type {HTMLButtonElement} */ ($('picker-add')),
  pickerOptions: $('picker-options'),
  status: $('rate-status'), primary: $('status-primary'), secondary: $('status-secondary'), retry: $('retry'),
};

const storage = createStorage({ onError: () => { $('storage-notice').hidden = false; } });
/** @type {Preferences} */
let preferences = storage.readPreferences() || { codes: [...DEFAULT_CODES], source: DEFAULT_SOURCE, amount: DEFAULT_AMOUNT };
/** @type {Snapshot|null} */ let snapshot = null;
/** @type {ReturnType<typeof createConverter>|null} */ let convert = null;
/** @type {Currency[]} */ let catalog = [...FALLBACK_CATALOG];
let catalogByCode = new Map(catalog.map(item => [item.code, item]));
let catalogCheckedAt = 0, catalogLoading = false, catalogRestored = null;
/** @type {Map<string,Row>} */ const rows = new Map();
let status = { phase: 'loading', checkedAt: null, error: null, retryAt: null, pending: false };

// The draft is the raw text in the source field. The app saves it only while it is not a valid amount.
let editing = false, inputError = '', inputDraft = '', draftInvalid = false;
// The revision changes with each local change. It shows if another tab's preferences are stale.
let revision = 0, pendingPreferences = null;
let saveTimer, toastTimer, heartbeat, undoAction = null;
let installAvailable = false, dragCode = '';

const pickerSelection = new Set();
const picker = createCurrencyPicker({ container: dom.pickerOptions, renderBadge: badge });
let pickerCatalog = null;

/** @type {ChartSettings|null} */ let chartSettings = null;
let chartUi = null, chartModule = null;
// Each screen change gets a new number. Work that waited for data stops if the number changed.
let navigation = 0, lastRouteHash = '', converterScroll = 0, chartReturnFocus = null;

function measure(name, action) {
  const start = performance.now();
  action();
  recordMeasure({ name, start });
}

function say(message) { $('announcer').textContent = message; }

function hideToast() {
  clearTimeout(toastTimer);
  undoAction = null;
  $('toast').hidden = true;
  $('manage-undo').hidden = true;
  $('manage-feedback').textContent = '';
}

/** Show a message for eight seconds. The manage dialog shows the Undo copy, because it covers the toast.
 * @param {{message:string,undo?:(()=>void)|null}} options */
function toast({ message, undo = null }) {
  clearTimeout(toastTimer);
  undoAction = undo;
  $('toast-message').textContent = message;
  $('toast').hidden = false;
  $('undo').hidden = !undo;
  $('manage-undo').hidden = !undo;
  $('manage-feedback').textContent = undo ? message : '';
  toastTimer = setTimeout(hideToast, 8000);
}

// Preferences

function writePreferences() {
  clearTimeout(saveTimer);
  if (draftInvalid && inputDraft) preferences.draft = inputDraft;
  else delete preferences.draft;
  storage.writePreferences(preferences);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writePreferences, 250);
}

function restoreDraft() {
  inputDraft = preferences.draft || '';
  const parsed = inputDraft ? parseAmount({ text: inputDraft, locale }) : null;
  draftInvalid = parsed?.status === 'invalid' || parsed?.status === 'incomplete';
  inputError = parsed?.status === 'invalid' ? parsed.message : '';
}

function applyPreferences(value) {
  preferences = value;
  // Undo can restore a removed row, but must not replace a newer tab's amount.
  revision++;
  restoreDraft(); renderList(); renderStatus();
}

// Another tab's preferences wait while the user edits. A local change in that time wins.
function applyPendingPreferences() {
  if (!pendingPreferences || editing || dom.manage.open || dom.picker.open) return false;
  const pending = pendingPreferences;
  pendingPreferences = null;
  if (pending.revision !== revision) { writePreferences(); return false; }
  applyPreferences(pending.value);
  return true;
}

// Currency cards

function badge(element, code) {
  if (!localBadges.has(code)) { element.textContent = code; return; }
  const image = document.createElement('img');
  image.src = `${base}badges/${code}.svg`;
  image.alt = '';
  image.width = 34; image.height = 34;
  image.addEventListener('error', () => { element.textContent = code; }, { once: true });
  element.replaceChildren(image);
}

function amountFor(code) {
  if (draftInvalid || !preferences.amount) return null;
  if (code === preferences.source) return preferences.amount;
  return convert?.({ amount: preferences.amount, source: preferences.source, target: code }) ?? null;
}

function createRow(code) {
  const element = /** @type {HTMLElement} */ (dom.template.content.firstElementChild.cloneNode(true));
  const input = /** @type {HTMLInputElement} */ (element.querySelector('.amount'));
  const row = /** @type {Row} */ ({
    element, input, amount: null,
    badge: element.querySelector('.currency-badge'), code: element.querySelector('.currency-code'),
    name: element.querySelector('.currency-name'), unit: element.querySelector('.unit-rate'),
    error: element.querySelector('.field-error'), history: element.querySelector('.history-link'),
  });
  element.dataset.code = code;
  input.id = `amount-${code}`;
  input.dataset.code = code;
  /** @type {HTMLLabelElement} */ (element.querySelector('.currency-identity')).htmlFor = input.id;
  row.error.id = `error-${code}`;
  row.unit.id = `unit-${code}`;
  input.setAttribute('aria-describedby', `${row.unit.id} ${row.error.id}`);
  row.code.textContent = code;
  row.history.dataset.historyQuote = code;
  row.history.addEventListener('click', () => {
    void showChart({ pair: { base: preferences.source, quote: code }, push: true, opener: row.history });
  });
  badge(row.badge, code);
  rows.set(code, row);
  return row;
}

// Make the cards match the saved list. Keep each card's nodes, and move a card only when its position changed.
function renderList() {
  for (const [code, row] of rows) {
    if (!preferences.codes.includes(code)) { row.element.remove(); rows.delete(code); }
  }
  preferences.codes.forEach((code, index) => {
    const row = rows.get(code) || createRow(code);
    const name = catalogByCode.get(code)?.name;
    row.name.textContent = name || code;
    row.name.title = name || code;
    row.input.setAttribute('aria-label', `${code} amount${name ? `, ${name}` : ''}`);
    if (dom.list.children[index] !== row.element) dom.list.insertBefore(row.element, dom.list.children[index] || null);
  });
  $('currency-count').textContent = String(preferences.codes.length);
  renderAmounts();
  renderUnits();
}

// This runs for each keystroke. Write to the page only when a value changed.
function renderAmounts() {
  for (const [code, row] of rows) {
    row.amount = amountFor(code);
    const source = code === preferences.source;
    if (row.element.dataset.source !== String(source)) {
      row.element.dataset.source = String(source);
      row.input.setAttribute('aria-current', String(source));
    }
    const invalid = String(source && draftInvalid);
    if (row.input.getAttribute('aria-invalid') !== invalid) row.input.setAttribute('aria-invalid', invalid);
    const error = source ? inputError : '';
    if (row.error.hidden !== !error) row.error.hidden = !error;
    if (row.error.textContent !== error) row.error.textContent = error;
    // Leave the field that the user edits alone. Its text must stay exactly as typed.
    if (editing && document.activeElement === row.input) continue;
    let value = '';
    if (source && draftInvalid) value = inputDraft;
    else if (row.amount !== null) value = formatAmount({ amount: row.amount, currency: code, locale });
    if (row.input.value !== value) row.input.value = value;
  }
}

function unitText(code) {
  if (code === preferences.source) return snapshot && !snapshot.rates[code] ? 'Source rate unavailable' : 'You set the amount';
  if (!convert) return 'Waiting for rates';
  return formatUnitRate({ source: preferences.source, target: code, convert, locale });
}

function renderUnits() {
  for (const [code, row] of rows) {
    row.unit.textContent = unitText(code);
    row.history.hidden = code === preferences.source;
    row.history.setAttribute('aria-label', `View ${preferences.source} to ${code} history`);
  }
}

// Rate status

const dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const readableDate = date => dateFormat.format(new Date(`${date}T00:00:00Z`));

function renderStatus() {
  const dates = snapshot ? rateDates({ source: preferences.source, codes: preferences.codes, rates: snapshot.rates }) : { oldest: null, newest: null };
  let dateText = 'Reference rates from Frankfurter';
  if (dates.oldest) {
    dateText = dates.oldest === dates.newest
      ? `Rates dated ${readableDate(dates.oldest)}`
      : `Rate dates: ${readableDate(dates.oldest)} – ${readableDate(dates.newest)}`;
  }
  const checked = snapshot ? formatChecked({ checkedAt: snapshot.checkedAt }) : '';
  const offline = !navigator.onLine || status.phase === 'offline';

  let primary = dateText;
  if (offline) primary = snapshot ? 'Offline — using saved rates' : 'Connect once to load rates';
  else if (status.phase === 'error' || status.error) primary = snapshot ? 'Could not update — using saved rates' : 'Rates could not be loaded';
  else if (!snapshot) primary = 'Getting your rates…';
  else if (dates.oldest && isOldRate({ date: dates.oldest })) primary = 'Some rates are more than 7 days old';

  let secondary = 'Your amounts stay on this device';
  if (snapshot && status.pending) secondary = `${checked} · New rates ready when you finish editing`;
  else if (snapshot && status.phase === 'refreshing') secondary = `${dateText} · Checking for updates…`;
  else if (snapshot) secondary = primary === dateText ? `${checked} · Frankfurter` : `${dateText} · ${checked}`;

  dom.status.dataset.phase = offline ? 'offline' : status.phase;
  dom.list.setAttribute('aria-busy', String(!snapshot && status.phase === 'loading'));
  dom.retry.hidden = status.phase !== 'error' || offline;
  dom.primary.textContent = primary;
  dom.secondary.textContent = secondary;
  if (dom.about.open) renderDetails();
}

// A cross rate uses two dates. USD is the base and has no date of its own.
function detailText(code) {
  if (code === preferences.source) return 'Source amount';
  if (!snapshot?.rates[code]) return 'Rate unavailable';
  const dates = new Set([preferences.source, code].filter(leg => leg !== 'USD').map(leg => snapshot.rates[leg]?.date).filter(Boolean));
  return dates.size ? [...dates].sort().map(readableDate).join(' / ') : 'Identity rate';
}

function renderDetails() {
  const items = preferences.codes.flatMap(code => {
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = code;
    value.textContent = detailText(code);
    return [term, value];
  });
  $('rate-details').replaceChildren(...items);
}

const rates = createRateController({
  storage, fetchRates, getSource: () => preferences.source, isEditing: () => editing,
  onApply: data => {
    const first = !snapshot;
    snapshot = data;
    convert = createConverter({ rates: data.rates });
    renderAmounts(); renderUnits(); renderStatus();
    if (!first) say('Rates checked. Your source amount is unchanged.');
    if (dom.picker.open) filterPicker();
  },
  onStatus: next => { status = next; renderStatus(); },
});

function refresh({ force = false } = {}) {
  return rates.refresh({ force, online: navigator.onLine, visible: document.visibilityState !== 'hidden' });
}

// Amount editing

function endEdit() {
  editing = false;
  if (!applyPendingPreferences()) writePreferences();
  rates.flushPending();
  renderAmounts(); renderStatus();
}

dom.list.addEventListener('focusin', event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  const code = input.dataset.code;
  if (!code) return;
  measure('fex:select-source', () => {
    if (code !== preferences.source) {
      // Use the unrounded result as the new source amount. The text on the card is a rounded copy.
      preferences = { ...preferences, source: code, amount: rows.get(code).amount ?? '' };
      draftInvalid = false; inputError = '';
      revision++;
    }
    editing = true;
    input.value = draftInvalid ? inputDraft : formatEditable({ amount: preferences.amount, locale });
    inputDraft = input.value;
    renderAmounts(); renderUnits(); renderStatus();
    scheduleSave();
  });
  queueMicrotask(() => { if (document.activeElement === input) input.select(); });
});

dom.list.addEventListener('input', event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (input.dataset.code !== preferences.source) return;
  measure('fex:amount-input', () => {
    inputDraft = input.value;
    const parsed = parseAmount({ text: input.value, locale });
    draftInvalid = parsed.status === 'invalid' || parsed.status === 'incomplete';
    inputError = parsed.status === 'invalid' ? parsed.message : '';
    preferences.amount = parsed.status === 'valid' ? parsed.value : '';
    revision++;
    renderAmounts();
    scheduleSave();
  });
});

dom.list.addEventListener('focusout', () => {
  // Focus can move directly to a different amount. That continues the edit.
  queueMicrotask(() => { if (!document.activeElement?.classList.contains('amount')) endEdit(); });
});

dom.list.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  /** @type {HTMLElement} */ (event.target).blur();
});

// Dialogs

const dialogOpeners = new WeakMap();

/** @param {{dialog:HTMLDialogElement,opener?:Element|null}} options */
function showDialog({ dialog: target, opener = document.activeElement }) {
  if (target.open) return;
  dialogOpeners.set(target, opener);
  target.showModal();
}

for (const button of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-close]'))) {
  button.addEventListener('click', () => dialog(button.dataset.close).close());
}

for (const target of document.querySelectorAll('dialog')) {
  // A click on the backdrop has the dialog as its target and is outside the dialog's box.
  target.addEventListener('click', event => {
    if (event.target !== target) return;
    const rect = target.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) target.close();
  });
  target.addEventListener('close', () => queueMicrotask(() => {
    applyPendingPreferences();
    rates.flushPending();
    const opener = dialogOpeners.get(target);
    if (!document.querySelector('dialog[open]') && opener?.isConnected) opener.focus();
  }));
}

// The menu closes before a dialog from it opens, so focus must go back to the menu button.
function openAbout(event) {
  const opener = event.currentTarget === $('menu-rates') ? $('menu-open') : event.currentTarget;
  dom.menu.close();
  renderDetails();
  showDialog({ dialog: dom.about, opener });
}

$('menu-open').addEventListener('click', () => showDialog({ dialog: dom.menu, opener: $('menu-open') }));
$('rates-open').addEventListener('click', openAbout);
$('chart-rates-open').addEventListener('click', openAbout);
$('menu-rates').addEventListener('click', openAbout);
dom.retry.addEventListener('click', () => { void refresh({ force: true }); });

// Screens and chart navigation

/** @returns {ChartSettings|null} */
function validChartSettings(value) {
  const valid = value && value.base !== value.quote && catalogByCode.has(value.base) && catalogByCode.has(value.quote) && HISTORY_PERIODS.includes(value.period);
  return valid ? { base: value.base, quote: value.quote, period: value.period } : null;
}

function defaultChartSettings() {
  const baseCode = catalogByCode.has(preferences.source) ? preferences.source : DEFAULT_SOURCE;
  const quoteCode = preferences.codes.find(code => code !== baseCode && catalogByCode.has(code))
    || catalog.find(item => item.code !== baseCode)?.code || 'VND';
  return { base: baseCode, quote: quoteCode, period: '1M' };
}

// A saved pair can use a code that is only in the saved catalog, so restore that catalog first.
async function savedChartSettings() {
  await restoreSavedCatalog();
  return chartSettings || validChartSettings(storage.readChartSettings());
}

function chartLocation(settings) {
  return `${location.pathname}${location.search}#chart?${new URLSearchParams(settings)}`;
}

function persistChartSettings(settings) {
  const valid = validChartSettings(settings);
  if (!valid) return;
  chartSettings = valid;
  storage.writeChartSettings(chartSettings);
  if (!location.hash.startsWith('#chart')) return;
  // A change of pair or period replaces the chart's history entry. It does not add one.
  history.replaceState(null, '', chartLocation(chartSettings));
  lastRouteHash = location.hash;
}

async function loadChartUi() {
  chartModule ??= import('./chart.js').catch(error => { chartModule = null; throw error; });
  const { createChartScreen } = await chartModule;
  chartUi ??= createChartScreen({ storage, locale, renderBadge: badge, catalog, onSelectionChange: persistChartSettings });
  return chartUi;
}

// The converter stays in the page while the chart shows, so its draft and scroll position remain.
function setScreen(screen) {
  const chart = screen === 'chart';
  const leavingConvert = chart && !dom.convertScreen.hidden;
  if (leavingConvert) converterScroll = window.scrollY;
  dom.convertScreen.hidden = chart;
  dom.chartScreen.hidden = !chart;
  dom.convertTab.setAttribute('aria-pressed', String(!chart));
  dom.chartTab.setAttribute('aria-pressed', String(chart));
  if (leavingConvert) window.scrollTo({ top: 0, behavior: 'instant' });
  if (chart) return;
  chartUi?.close();
  const shown = navigation;
  requestAnimationFrame(() => {
    if (shown !== navigation) return;
    window.scrollTo({ top: converterScroll, behavior: 'instant' });
    (chartReturnFocus?.isConnected ? chartReturnFocus : dom.convertHeading).focus({ preventScroll: true });
    chartReturnFocus = null;
  });
}

// The chart code did not load. Its own status and Retry elements are in the page already.
function showChartLoadFailure() {
  $('chart-content').setAttribute('aria-busy', 'false');
  $('history-chart').setAttribute('hidden', '');
  $('chart-empty').hidden = true;
  $('chart-status').dataset.phase = 'error';
  $('chart-status-primary').textContent = 'The chart could not be loaded.';
  $('chart-status-secondary').textContent = navigator.onLine ? 'Try again to reload the chart.' : 'Connect to the internet, then try again.';
  $('chart-retry').hidden = false;
}

/** Show the chart. `settings` comes from a link. `pair` comes from a currency card and keeps the last period.
 * With neither, the chart shows the saved pair, or the converter's source and first other currency.
 * @param {{settings?:object|null,pair?:{base:string,quote:string}|null,push?:boolean,opener?:HTMLElement|null}} [options] */
async function showChart({ settings = null, pair = null, push = false, opener = null } = {}) {
  const shown = ++navigation;
  const start = performance.now();
  if (opener) chartReturnFocus = opener;
  setScreen('chart');
  const saved = await savedChartSettings();
  if (shown !== navigation) return;
  const requested = pair ? { ...pair, period: saved?.period || '1M' } : settings;
  const chosen = validChartSettings(requested) || saved || defaultChartSettings();
  if (push) history.pushState(null, '', chartLocation(chosen));
  persistChartSettings(chosen);

  let ui;
  try { ui = await loadChartUi(); } catch {
    if (shown === navigation) showChartLoadFailure();
    return;
  }
  if (shown !== navigation) return;
  const opened = ui.open({ ...chosen, online: navigator.onLine });
  dom.chartHeading.focus({ preventScroll: true });
  await opened;
  if (shown === navigation) recordMeasure({ name: 'fex:chart-open', start });
}

function showConvert({ push = false } = {}) {
  ++navigation;
  if (push) history.pushState(null, '', `${location.pathname}${location.search}`);
  lastRouteHash = location.hash;
  setScreen('convert');
}

// The address is `#chart?base=USD&quote=VND&period=1M` for the chart and has no fragment for the converter.
async function applyLocation() {
  const hash = location.hash;
  if (hash === lastRouteHash) return;
  lastRouteHash = hash;
  if (!hash.startsWith('#chart')) { showConvert(); return; }
  const shown = ++navigation;
  const saved = await savedChartSettings();
  if (shown !== navigation) return;
  const params = new URLSearchParams(hash.startsWith('#chart?') ? hash.slice('#chart?'.length) : '');
  const linked = validChartSettings({ base: params.get('base'), quote: params.get('quote'), period: params.get('period') });
  // A bad link keeps the saved pair but goes back to the default period.
  const fallback = saved && hash !== '#chart' ? { ...saved, period: '1M' } : saved;
  void showChart({ settings: linked || fallback });
}

dom.convertTab.addEventListener('click', () => { if (dom.convertScreen.hidden) showConvert({ push: true }); });
dom.chartTab.addEventListener('click', () => { if (dom.chartScreen.hidden) void showChart({ push: true }); });
// Back and Forward send both events in most browsers. `applyLocation` ignores the second one.
window.addEventListener('popstate', () => { void applyLocation(); });
window.addEventListener('hashchange', () => { void applyLocation(); });
// After the chart code loads, the chart handles Retry.
$('chart-retry').addEventListener('click', () => { if (!chartUi && !dom.chartScreen.hidden) void showChart(); });

// Add currencies

function buildPicker() {
  if (pickerCatalog === catalog) return;
  picker.setCatalog(catalog);
  pickerCatalog = catalog;
  for (const code of pickerSelection) if (!catalogByCode.has(code)) pickerSelection.delete(code);
}

const plural = count => (count === 1 ? 'currency' : 'currencies');

function filterPicker() {
  const search = normalizeSearch(dom.search.value);
  const visible = picker.render({ search, codes: preferences.codes, selected: pickerSelection, rates: snapshot?.rates || null });
  const count = pickerSelection.size;
  $('search-clear').hidden = !search;
  $('no-currencies').hidden = visible !== 0;
  $('picker-count').textContent = `${visible} ${visible === 1 ? 'currency or unit' : 'currencies and units'}${navigator.onLine ? '' : ' · Saved list'}`;
  dom.pickerAdd.disabled = count === 0;
  dom.pickerAdd.textContent = count ? `Add ${count} ${plural(count)}` : 'Add currencies';
}

$('add-open').addEventListener('click', () => measure('fex:picker-open', () => {
  pickerSelection.clear();
  dom.search.value = '';
  buildPicker();
  filterPicker();
  showDialog({ dialog: dom.picker, opener: $('add-open') });
  dom.search.focus();
}));
dom.search.addEventListener('input', () => measure('fex:picker-search', filterPicker));
$('search-clear').addEventListener('click', () => { dom.search.value = ''; filterPicker(); dom.search.focus(); });
dom.pickerOptions.addEventListener('change', event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (input.checked) pickerSelection.add(input.value); else pickerSelection.delete(input.value);
  filterPicker();
});
dom.pickerAdd.addEventListener('click', () => {
  const added = [...pickerSelection].filter(code => !preferences.codes.includes(code));
  preferences.codes.push(...added);
  revision++;
  renderList();
  scheduleSave();
  dom.picker.close();
  toast({ message: `${added.length} ${plural(added.length)} added.` });
});

// Manage currencies

function focusManage({ code, direction = null }) {
  const row = dom.manage.querySelector(`[data-code="${code}"]`);
  const preferred = direction ? row?.querySelector(`[data-move="${direction}"]:not(:disabled)`) : row?.querySelector('.remove:not(:disabled)');
  const control = preferred || row?.querySelector('button:not(:disabled)') || dom.manage.querySelector('[data-close="manage"]');
  /** @type {HTMLElement} */ (control).focus();
}

function moveCurrency({ code, to }) {
  const from = preferences.codes.indexOf(code);
  if (from === -1 || to < 0 || to >= preferences.codes.length || from === to) return;
  preferences.codes.splice(from, 1);
  preferences.codes.splice(to, 0, code);
  revision++;
  renderList(); renderManage();
  scheduleSave();
  say(`${code} moved to position ${to + 1}.`);
  focusManage({ code, direction: Math.sign(to - from) });
}

function removeCurrency(code) {
  if (preferences.codes.length < 2) return;
  const before = { ...preferences, codes: [...preferences.codes] };
  const position = before.codes.indexOf(code);
  const remaining = before.codes.filter(item => item !== code);
  if (code === preferences.source) {
    // The next currency with a rate becomes the source and keeps its exact converted value.
    const next = remaining.find(item => snapshot?.rates[item]);
    preferences = { codes: remaining, source: next || remaining[0], amount: next ? amountFor(next) ?? '' : '' };
    draftInvalid = false; inputError = '';
  } else preferences.codes = remaining;
  const removedRevision = ++revision;
  renderList(); renderManage();
  scheduleSave();
  focusManage({ code: remaining[Math.min(position, remaining.length - 1)] });
  toast({
    message: `${code} removed.`,
    undo: () => {
      // If something changed after the removal, put only the row back. Keep the newer source and amount.
      if (revision === removedRevision) preferences = before;
      else if (!preferences.codes.includes(code)) preferences.codes.splice(Math.min(position, preferences.codes.length), 0, code);
      revision++;
      restoreDraft(); renderList();
      if (dom.manage.open) { renderManage(); focusManage({ code }); }
      scheduleSave();
    },
  });
}

function iconButton({ label, icon, action, disabled = false, className = '' }) {
  const button = document.createElement('button');
  button.className = `icon-button ${className}`;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon small');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', `#icon-${icon}`);
  svg.append(use);
  button.append(svg);
  button.addEventListener('click', action);
  return button;
}

function manageRow({ code, index }) {
  const row = document.createElement('div');
  row.className = 'manage-row';
  row.dataset.code = code;
  row.draggable = true;
  const mark = document.createElement('span');
  mark.className = 'currency-badge';
  badge(mark, code);
  const identity = document.createElement('span');
  identity.className = 'identity-copy';
  const name = document.createElement('span');
  name.className = 'currency-code';
  name.textContent = code;
  const detail = document.createElement('span');
  detail.className = 'currency-name';
  detail.textContent = catalogByCode.get(code)?.name || code;
  identity.append(name, detail);
  const controls = document.createElement('div');
  controls.className = 'manage-actions';
  const last = preferences.codes.length - 1;
  const up = iconButton({ label: `Move ${code} up`, icon: 'up', disabled: index === 0, action: () => moveCurrency({ code, to: index - 1 }) });
  const down = iconButton({ label: `Move ${code} down`, icon: 'down', disabled: index === last, action: () => moveCurrency({ code, to: index + 1 }) });
  up.dataset.move = '-1';
  down.dataset.move = '1';
  const remove = iconButton({ label: `Remove ${code}`, icon: 'close', className: 'remove', disabled: last === 0, action: () => removeCurrency(code) });
  controls.append(up, down, remove);
  row.append(mark, identity, controls);
  return row;
}

function renderManage() {
  $('manage-list').replaceChildren(...preferences.codes.map((code, index) => manageRow({ code, index })));
}

const manageRowCode = event => /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest('.manage-row'))?.dataset.code || '';

$('manage-open').addEventListener('click', () => {
  dom.menu.close();
  renderManage();
  showDialog({ dialog: dom.manage, opener: $('menu-open') });
});
$('manage-list').addEventListener('dragstart', event => {
  dragCode = manageRowCode(event);
  event.dataTransfer?.setData('text/plain', dragCode);
});
$('manage-list').addEventListener('dragover', event => { if (dragCode) event.preventDefault(); });
$('manage-list').addEventListener('drop', event => {
  event.preventDefault();
  const target = manageRowCode(event);
  if (target && dragCode) moveCurrency({ code: dragCode, to: preferences.codes.indexOf(target) });
  dragCode = '';
});
$('manage-list').addEventListener('dragend', () => { dragCode = ''; });

function undoRemove() {
  undoAction?.();
  hideToast();
}
$('undo').addEventListener('click', undoRemove);
$('manage-undo').addEventListener('click', undoRemove);

// Currency catalog

function setCatalog(items) {
  // Keep a selected code even if the provider later removes it from its catalog.
  const map = new Map(items.map(item => [item.code, item]));
  for (const code of preferences.codes) {
    if (!map.has(code)) map.set(code, catalogByCode.get(code) || { code, name: `${code} (saved currency)`, symbol: code });
  }
  catalog = [...map.values()];
  catalogByCode = map;
  renderList();
  chartUi?.setCatalog(catalog);
  if (dom.picker.open) { buildPicker(); filterPicker(); }
}

function restoreSavedCatalog() {
  catalogRestored ??= storage.readCatalog().then(saved => {
    if (!saved || saved.checkedAt <= catalogCheckedAt) return;
    catalogCheckedAt = saved.checkedAt;
    setCatalog(saved.items);
  });
  return catalogRestored;
}

// The saved catalog gives the time of the last check, so read it before the decision to fetch.
async function updateCatalog() {
  await restoreSavedCatalog();
  if (catalogLoading || !navigator.onLine || document.hidden || isFresh({ checkedAt: catalogCheckedAt, maxAge: 86400000 })) return;
  catalogLoading = true;
  try {
    const items = await fetchCatalog();
    catalogCheckedAt = Date.now();
    setCatalog(items);
    await storage.writeCatalog({ items, checkedAt: catalogCheckedAt });
  } catch { /* The full bundled or saved catalog remains available. */ }
  finally { catalogLoading = false; }
}

// Installation and app updates

const pwa = createPwa({
  onUpdate: available => { $('update-notice').hidden = !available; },
  onInstallAvailable: available => { installAvailable = available; renderInstall(); },
  onInstalled: () => { $('install-open').hidden = true; toast({ message: 'Fex is ready on your home screen.' }); },
});

// iOS has no install prompt. It gets instructions for the Share menu.
function renderInstall() {
  $('install-open').hidden = pwa.isStandalone() || (!installAvailable && !ios);
}

$('install-open').addEventListener('click', () => {
  dom.menu.close();
  if (installAvailable) void pwa.install();
  else showDialog({ dialog: dom.installHelp, opener: $('menu-open') });
});
$('update-now').addEventListener('click', () => { writePreferences(); pwa.update(); });
$('update-later').addEventListener('click', () => { $('update-notice').hidden = true; });

// Other tabs and page lifecycle

storage.subscribe(async event => {
  if (event.type === 'rates') rates.acceptSaved(await storage.readRates());
  if (event.type !== 'preferences') return;
  if (editing || dom.manage.open || dom.picker.open) pendingPreferences = { value: event.value, revision };
  else applyPreferences(event.value);
});

function refreshChart() {
  if (!dom.chartScreen.hidden) void chartUi?.refresh({ online: navigator.onLine });
}

function startHeartbeat() {
  clearInterval(heartbeat);
  heartbeat = setInterval(() => { if (!document.hidden) { renderStatus(); void refresh(); } }, 30000);
}

// Focus and visibility events can come together. One check at a time is enough.
let resuming = false;
async function resume() {
  if (document.hidden || resuming) return;
  resuming = true;
  // A tab that was in the background can miss the notice that another tab saved rates.
  try { rates.acceptSaved(await storage.readRates()); } finally { resuming = false; }
  void refresh();
  void updateCatalog();
  refreshChart();
}

document.addEventListener('visibilitychange', resume);
window.addEventListener('focus', resume);
window.addEventListener('online', () => { void refresh(); void updateCatalog(); refreshChart(); });
window.addEventListener('offline', () => { void refresh(); refreshChart(); });
window.addEventListener('pagehide', () => { writePreferences(); clearInterval(heartbeat); chartUi?.close(); });
// A page from the back-forward cache continues without a new start.
window.addEventListener('pageshow', event => { if (event.persisted) { startHeartbeat(); void resume(); } });

// Start

restoreDraft(); renderList(); renderStatus(); renderInstall();
performance.mark('fex:controls-ready');
void (async () => {
  await rates.restore();
  performance.mark('fex:saved-rates-ready');
  void refresh();
  void updateCatalog();
})();
requestAnimationFrame(() => { void pwa.register(); });
startHeartbeat();
void applyLocation();
