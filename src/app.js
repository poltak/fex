import { createConverter, formatAmount, formatEditable, formatUnitRate, isOldRate, normalizeSearch, parseAmount, rateDates } from './domain.js';
import { DEFAULT_AMOUNT, DEFAULT_CODES, DEFAULT_SOURCE, FALLBACK_CATALOG } from './catalog.js';
import { createRateController, fetchCatalog, fetchRates, isFresh } from './data.js';
import { createStorage } from './storage.js';
import { createPwa } from './pwa/client.js';
import { createCurrencyPicker } from './picker.js';

/** @typedef {import('./data.js').Snapshot} Snapshot */
/** @typedef {import('./storage.js').Preferences} Preferences */
/** @typedef {{code:string,name:string,symbol:string}} Currency */
/** @typedef {{element:HTMLElement,input:HTMLInputElement,badge:HTMLElement,code:HTMLElement,name:HTMLElement,unit:HTMLElement,error:HTMLElement,amount:string|null}} Row */

const locale = navigator.language || 'en-US';
const base = import.meta.env.BASE_URL;
const localBadges = new Set(DEFAULT_CODES);
const $ = id => document.getElementById(id);
const dom = {
  list: $('currency-list'), template: /** @type {HTMLTemplateElement} */ ($('card-template')),
  picker: /** @type {HTMLDialogElement} */ ($('picker')), manage: /** @type {HTMLDialogElement} */ ($('manage')),
  menu: /** @type {HTMLDialogElement} */ ($('menu')), about: /** @type {HTMLDialogElement} */ ($('about')),
  installHelp: /** @type {HTMLDialogElement} */ ($('install-help')),
  search: /** @type {HTMLInputElement} */ ($('currency-search')),
  pickerAdd: /** @type {HTMLButtonElement} */ ($('picker-add')),
  pickerOptions: $('picker-options'), pickerCount: $('picker-count'), noCurrencies: $('no-currencies'),
  status: $('rate-status'), primary: $('status-primary'), secondary: $('status-secondary'), retry: $('retry'),
};

const storage = createStorage({ onError: () => { $('storage-notice').hidden = false; } });
/** @type {Preferences} */
let preferences = storage.readPreferences() || { codes: [...DEFAULT_CODES], source: DEFAULT_SOURCE, amount: DEFAULT_AMOUNT };
/** @type {Snapshot|null} */ let snapshot = null;
/** @type {ReturnType<typeof createConverter>|null} */ let convert = null;
/** @type {Currency[]} */ let catalog = [...FALLBACK_CATALOG];
let catalogByCode = new Map(catalog.map(item => [item.code, item]));
/** @type {Map<string,Row>} */ const rows = new Map();
let editing = false, inputError = '', inputDraft = '', draftInvalid = false;
let saveTimer, toastTimer, heartbeat, pendingPreferences = null;
let revision = 0, undoAction = null;
const pickerSelection = new Set();
let pickerCatalog = null;
const picker = createCurrencyPicker({ container: dom.pickerOptions, renderBadge: badge });
let status = { phase: 'loading', checkedAt: null, error: null, retryAt: null, pending: false };
let catalogCheckedAt = 0, catalogLoading = false, dragCode = '';
let installAvailable = false;
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function measure(name, action) {
  const start = performance.now();
  action();
  performance.measure(name, { start, end: performance.now() });
  const entries = performance.getEntriesByName(name);
  if (entries.length > 100) performance.clearMeasures(name);
}

function writePreferences() {
  clearTimeout(saveTimer);
  if (draftInvalid && inputDraft) preferences.draft = inputDraft;
  else delete preferences.draft;
  storage.writePreferences(preferences);
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
function applyPendingPreferences() {
  if (!pendingPreferences || editing || dom.manage.open || dom.picker.open) return false;
  const pending = pendingPreferences;
  pendingPreferences = null;
  if (pending.revision !== revision) { writePreferences(); return false; }
  applyPreferences(pending.value);
  return true;
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(writePreferences, 250); }
function say(message) { $('announcer').textContent = message; }
function toast(message, undo = null) {
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  $('toast').hidden = false;
  $('undo').hidden = !undo;
  undoAction = undo;
  $('manage-undo').hidden = !undo;
  $('manage-feedback').textContent = undo ? message : '';
  toastTimer = setTimeout(() => { $('toast').hidden = true; $('manage-undo').hidden = true; $('manage-feedback').textContent = ''; undoAction = null; }, 8000);
}

function badge(element, code) {
  element.replaceChildren();
  if (localBadges.has(code)) {
    const image = document.createElement('img');
    image.src = `${base}badges/${code}.svg`;
    image.alt = '';
    image.width = 34; image.height = 34;
    image.addEventListener('error', () => { element.textContent = code; }, { once: true });
    element.append(image);
  } else element.textContent = code;
}

function amountFor(code) {
  if (draftInvalid || !preferences.amount) return null;
  if (code === preferences.source) return preferences.amount;
  return convert?.({ amount: preferences.amount, source: preferences.source, target: code }) ?? null;
}

function createRow(code) {
  const element = /** @type {HTMLElement} */ (dom.template.content.firstElementChild.cloneNode(true));
  const input = /** @type {HTMLInputElement} */ (element.querySelector('.amount'));
  input.id = `amount-${code}`;
  input.dataset.code = code;
  element.dataset.code = code;
  const identity = /** @type {HTMLLabelElement} */ (element.querySelector('.currency-identity'));
  identity.htmlFor = input.id;
  const row = /** @type {Row} */ ({
    element, input, badge: element.querySelector('.currency-badge'), code: element.querySelector('.currency-code'),
    name: element.querySelector('.currency-name'), unit: element.querySelector('.unit-rate'), error: element.querySelector('.field-error'), amount: null,
  });
  row.error.id = `error-${code}`;
  row.unit.id = `unit-${code}`;
  input.setAttribute('aria-describedby', `${row.unit.id} ${row.error.id}`);
  badge(row.badge, code);
  rows.set(code, row);
  return row;
}

function renderList() {
  for (const [code, row] of rows) if (!preferences.codes.includes(code)) { row.element.remove(); rows.delete(code); }
  preferences.codes.forEach((code, index) => {
    const row = rows.get(code) || createRow(code);
    const item = catalogByCode.get(code);
    row.code.textContent = code;
    row.name.textContent = item?.name || code;
    row.name.title = item?.name || code;
    row.input.setAttribute('aria-label', `${code} amount${item ? `, ${item.name}` : ''}`);
    if (dom.list.children[index] !== row.element) dom.list.insertBefore(row.element, dom.list.children[index] || null);
  });
  $('currency-count').textContent = String(preferences.codes.length);
  renderAmounts();
  renderUnits();
}

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
    // Keep the editing node and its exact draft intact; never round-trip display text.
    if (editing && document.activeElement === row.input) continue;
    const value = source && draftInvalid ? inputDraft : row.amount === null ? '' : formatAmount({ amount: row.amount, currency: code, locale });
    if (row.input.value !== value) row.input.value = value;
  }
}

function renderUnits() {
  for (const [code, row] of rows) {
    const source = code === preferences.source;
    row.unit.textContent = source ? snapshot && !snapshot.rates[code] ? 'Source rate unavailable' : 'You set the amount' : snapshot ? formatUnitRate({ source: preferences.source, target: code, rates: snapshot.rates, locale }) : 'Waiting for rates';
  }
}

const dateFormat = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
function readableDate(date) { return date ? dateFormat.format(new Date(`${date}T00:00:00Z`)) : 'Unavailable'; }
function renderStatus() {
  const dates = snapshot ? rateDates({ source: preferences.source, codes: preferences.codes, rates: snapshot.rates }) : { oldest: null, newest: null };
  const dateText = dates.oldest ? dates.oldest === dates.newest ? `Rates dated ${readableDate(dates.oldest)}` : `Rate dates: ${readableDate(dates.oldest)} – ${readableDate(dates.newest)}` : 'Reference rates from Frankfurter';
  const minutes = snapshot ? Math.max(0, Math.floor((Date.now() - snapshot.checkedAt) / 60000)) : 0;
  const checked = !snapshot ? '' : minutes < 1 ? 'Checked just now' : minutes < 60 ? `Checked ${minutes} min ago` : minutes < 1440 ? `Checked ${Math.floor(minutes / 60)} hr ago` : `Checked ${Math.floor(minutes / 1440)} days ago`;
  const offline = !navigator.onLine || status.phase === 'offline';
  dom.status.dataset.phase = offline ? 'offline' : status.phase;
  dom.list.setAttribute('aria-busy', String(!snapshot && status.phase === 'loading'));
  dom.retry.hidden = status.phase !== 'error' || offline;
  if (offline) dom.primary.textContent = snapshot ? 'Offline — using saved rates' : 'Connect once to load rates';
  else if (status.phase === 'error' || status.error) dom.primary.textContent = snapshot ? 'Could not update — using saved rates' : 'Rates could not be loaded';
  else if (!snapshot) dom.primary.textContent = 'Getting your rates…';
  else if (dates.oldest && isOldRate({ date: dates.oldest })) dom.primary.textContent = 'Some rates are more than 7 days old';
  else dom.primary.textContent = dateText;
  dom.secondary.textContent = !snapshot ? 'Your amounts stay on this device' : status.pending ? `${checked} · New rates ready when you finish editing` : status.phase === 'refreshing' ? `${dateText} · Checking for updates…` : (dom.primary.textContent === dateText ? `${checked} · Frankfurter` : `${dateText} · ${checked}`);
  if (dom.about.open) renderDetails();
}

function renderDetails() {
  const target = $('rate-details');
  target.replaceChildren();
  for (const code of preferences.codes) {
    const term = document.createElement('dt'); term.textContent = code;
    const value = document.createElement('dd');
    const sourceDate = preferences.source !== 'USD' ? snapshot?.rates[preferences.source]?.date : null;
    const targetDate = code !== 'USD' ? snapshot?.rates[code]?.date : null;
    const dates = [...new Set([sourceDate, targetDate].filter(Boolean))].sort();
    value.textContent = code === preferences.source ? 'Source amount' : !snapshot?.rates[code] ? 'Rate unavailable' : dates.length ? dates.map(readableDate).join(' / ') : 'Identity rate';
    target.append(term, value);
  }
}

const rates = createRateController({
  storage, fetchRates, getSource: () => preferences.source, isEditing: () => editing,
  onApply: data => {
    const previous = snapshot;
    snapshot = data;
    convert = createConverter({ rates: data.rates });
    renderAmounts(); renderUnits(); renderStatus();
    if (previous && previous !== data) say('Rates checked. Your source amount is unchanged.');
    if (dom.picker.open) filterPicker();
  },
  onStatus: next => { status = next; renderStatus(); },
});

function refresh({ force = false } = {}) {
  return rates.refresh({ force, online: navigator.onLine, visible: document.visibilityState !== 'hidden' });
}

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
  const current = rows.get(code);
  measure('fex:select-source', () => {
    if (code !== preferences.source) {
      preferences = { ...preferences, source: code, amount: current.amount ?? '' };
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
  queueMicrotask(() => { if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('amount'))) endEdit(); });
});
dom.list.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); /** @type {HTMLElement} */ (event.target).blur(); } });

const dialogOpeners = new WeakMap();
function showDialog({ dialog, opener = document.activeElement }) {
  if (dialog.open) return;
  dialogOpeners.set(dialog, opener);
  dialog.showModal();
}
function openAbout(event) {
  const opener = event.currentTarget === $('menu-rates') ? $('menu-open') : $('rates-open');
  dom.menu.close(); renderDetails(); showDialog({ dialog: dom.about, opener });
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => /** @type {HTMLDialogElement} */ ($(/** @type {HTMLElement} */ (button).dataset.close)).close());
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => queueMicrotask(() => {
    applyPendingPreferences(); rates.flushPending();
    const opener = dialogOpeners.get(dialog);
    if (!document.querySelector('dialog[open]') && opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }));
}
$('menu-open').addEventListener('click', () => showDialog({ dialog: dom.menu, opener: $('menu-open') }));
$('rates-open').addEventListener('click', openAbout);
$('menu-rates').addEventListener('click', openAbout);
dom.retry.addEventListener('click', () => { void refresh({ force: true }); });

function buildPicker() {
  if (pickerCatalog === catalog) return;
  picker.setCatalog(catalog);
  pickerCatalog = catalog;
  for (const code of pickerSelection) if (!catalogByCode.has(code)) pickerSelection.delete(code);
}

function filterPicker() {
  const search = normalizeSearch(dom.search.value);
  const visible = picker.render({ search, codes: preferences.codes, selected: pickerSelection, rates: snapshot?.rates || null });
  $('search-clear').hidden = !search;
  dom.noCurrencies.hidden = visible !== 0;
  dom.pickerCount.textContent = `${visible} ${visible === 1 ? 'currency or unit' : 'currencies and units'}${!navigator.onLine ? ' · Saved list' : ''}`;
  dom.pickerAdd.disabled = pickerSelection.size === 0;
  dom.pickerAdd.textContent = pickerSelection.size ? `Add ${pickerSelection.size} ${pickerSelection.size === 1 ? 'currency' : 'currencies'}` : 'Add currencies';
}

$('add-open').addEventListener('click', () => measure('fex:picker-open', () => {
  pickerSelection.clear(); dom.search.value = ''; buildPicker(); filterPicker(); showDialog({ dialog: dom.picker, opener: $('add-open') }); dom.search.focus();
}));
dom.search.addEventListener('input', () => measure('fex:picker-search', filterPicker));
$('search-clear').addEventListener('click', () => { dom.search.value = ''; filterPicker(); dom.search.focus(); });
dom.pickerOptions.addEventListener('change', event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (input.checked) pickerSelection.add(input.value); else pickerSelection.delete(input.value);
  filterPicker();
});
dom.pickerAdd.addEventListener('click', () => {
  const selected = [...pickerSelection].filter(code => !preferences.codes.includes(code));
  preferences.codes.push(...selected); revision++; renderList(); scheduleSave(); dom.picker.close(); toast(`${selected.length} ${selected.length === 1 ? 'currency' : 'currencies'} added.`);
});

function focusManage({ code, direction = null }) {
  const row = dom.manage.querySelector(`[data-code="${code}"]`);
  const preferred = direction ? row?.querySelector(`[data-move="${direction}"]:not(:disabled)`) : row?.querySelector('.remove:not(:disabled)');
  const control = preferred || row?.querySelector('button:not(:disabled)') || dom.manage.querySelector('[data-close="manage"]');
  if (control instanceof HTMLElement) control.focus();
}
function moveCurrency({ code, to }) {
  const from = preferences.codes.indexOf(code);
  if (from === -1 || to < 0 || to >= preferences.codes.length || from === to) return;
  preferences.codes.splice(from, 1); preferences.codes.splice(to, 0, code);
  revision++; renderList(); renderManage(); scheduleSave(); say(`${code} moved to position ${to + 1}.`);
  focusManage({ code, direction: Math.sign(to - from) });
}

function removeCurrency(code) {
  if (preferences.codes.length < 2) return;
  const before = { ...preferences, codes: [...preferences.codes] };
  const remaining = preferences.codes.filter(item => item !== code);
  if (code === preferences.source) {
    const next = remaining.find(item => snapshot?.rates[item]);
    preferences = { codes: remaining, source: next || remaining[0], amount: next ? amountFor(next) ?? '' : '' };
    draftInvalid = false; inputError = '';
  } else preferences.codes = remaining;
  const removedRevision = ++revision;
  renderList(); renderManage(); scheduleSave();
  focusManage({ code: remaining[Math.min(before.codes.indexOf(code), remaining.length - 1)] });
  toast(`${code} removed.`, () => {
    if (revision === removedRevision) preferences = before;
    else if (!preferences.codes.includes(code)) preferences.codes.splice(Math.min(before.codes.indexOf(code), preferences.codes.length), 0, code);
    revision++; restoreDraft(); renderList(); if (dom.manage.open) { renderManage(); focusManage({ code }); } scheduleSave();
  });
}

function iconButton({ label, icon, action, disabled = false, className = '' }) {
  const button = document.createElement('button'); button.className = `icon-button ${className}`; button.setAttribute('aria-label', label); button.disabled = disabled;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'icon small'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#icon-${icon}`); svg.append(use); button.append(svg); button.addEventListener('click', action);
  return button;
}

function renderManage() {
  const fragment = document.createDocumentFragment();
  preferences.codes.forEach((code, index) => {
    const row = document.createElement('div'); row.className = 'manage-row'; row.dataset.code = code; row.draggable = true;
    const mark = document.createElement('span'); mark.className = 'currency-badge'; badge(mark, code);
    const identity = document.createElement('span'); identity.className = 'identity-copy';
    const name = document.createElement('span'); name.className = 'currency-code'; name.textContent = code;
    const detail = document.createElement('span'); detail.className = 'currency-name'; detail.textContent = catalogByCode.get(code)?.name || code;
    identity.append(name, detail);
    const controls = document.createElement('div'); controls.className = 'manage-actions';
    for (const direction of [-1, 1]) {
      const button = iconButton({ label: `Move ${code} ${direction === -1 ? 'up' : 'down'}`, icon: direction === -1 ? 'up' : 'down', disabled: direction === -1 ? index === 0 : index === preferences.codes.length - 1, action: () => moveCurrency({ code, to: index + direction }) });
      button.dataset.move = String(direction); controls.append(button);
    }
    controls.append(iconButton({ label: `Remove ${code}`, icon: 'close', className: 'remove', disabled: preferences.codes.length === 1, action: () => removeCurrency(code) }));
    row.append(mark, identity, controls); fragment.append(row);
  });
  $('manage-list').replaceChildren(fragment);
}

$('manage-open').addEventListener('click', () => { dom.menu.close(); renderManage(); showDialog({ dialog: dom.manage, opener: $('menu-open') }); });
$('manage-list').addEventListener('dragstart', event => { const row = /** @type {HTMLElement} */ (event.target).closest('.manage-row'); dragCode = /** @type {HTMLElement} */ (row)?.dataset.code || ''; event.dataTransfer?.setData('text/plain', dragCode); });
$('manage-list').addEventListener('dragover', event => { if (dragCode) event.preventDefault(); });
$('manage-list').addEventListener('drop', event => { event.preventDefault(); const row = /** @type {HTMLElement} */ (event.target).closest('.manage-row'); if (row && dragCode) moveCurrency({ code: dragCode, to: preferences.codes.indexOf(/** @type {HTMLElement} */ (row).dataset.code) }); dragCode = ''; });
$('manage-list').addEventListener('dragend', () => { dragCode = ''; });
function undoRemove() { undoAction?.(); undoAction = null; $('toast').hidden = true; $('manage-undo').hidden = true; $('manage-feedback').textContent = ''; }
$('undo').addEventListener('click', undoRemove);
$('manage-undo').addEventListener('click', undoRemove);

function setCatalog(items) {
  // Keep a selected code even if the provider later removes it from its catalog.
  const map = new Map(items.map(item => [item.code, item]));
  for (const code of preferences.codes) if (!map.has(code)) map.set(code, catalogByCode.get(code) || { code, name: `${code} (saved currency)`, symbol: code });
  catalog = [...map.values()]; catalogByCode = map;
  renderList();
  if (dom.picker.open) { buildPicker(); filterPicker(); }
}

async function updateCatalog() {
  if (catalogLoading || !navigator.onLine || document.hidden || (catalogCheckedAt && isFresh({ checkedAt: catalogCheckedAt, maxAge: 86400000 }))) return;
  catalogLoading = true;
  try { const items = await fetchCatalog(); catalogCheckedAt = Date.now(); setCatalog(items); await storage.writeCatalog({ items, checkedAt: catalogCheckedAt }); }
  catch { /* The full bundled or saved catalog remains available. */ }
  finally { catalogLoading = false; }
}

const pwa = createPwa({
  onUpdate: available => { $('update-notice').hidden = !available; },
  onInstallAvailable: available => { installAvailable = available; renderInstall(); },
  onInstalled: () => { $('install-open').hidden = true; toast('Fex is ready on your home screen.'); },
  onOfflineReady: () => { /* Status stays about data, not implementation details. */ },
});
function renderInstall() { $('install-open').hidden = pwa.isStandalone() || (!installAvailable && !ios); }
$('install-open').addEventListener('click', async () => { dom.menu.close(); if (installAvailable) await pwa.install(); else showDialog({ dialog: dom.installHelp, opener: $('menu-open') }); });
$('update-now').addEventListener('click', () => { writePreferences(); pwa.update(); });
$('update-later').addEventListener('click', () => { $('update-notice').hidden = true; });

storage.subscribe(async event => {
  if (event.type === 'rates') rates.acceptSaved(await storage.readRates());
  if (event.type === 'preferences') {
    if (editing || dom.manage.open || dom.picker.open) pendingPreferences = { value: event.value, revision };
    else applyPreferences(event.value);
  }
});

async function resume() {
  if (document.hidden) return;
  rates.acceptSaved(await storage.readRates());
  void refresh(); void updateCatalog();
}
document.addEventListener('visibilitychange', resume);
window.addEventListener('focus', resume);
window.addEventListener('online', () => { void refresh(); void updateCatalog(); });
window.addEventListener('offline', () => { void refresh(); renderStatus(); });
window.addEventListener('pagehide', () => { writePreferences(); clearInterval(heartbeat); });
window.addEventListener('pageshow', () => { startHeartbeat(); void resume(); });
function startHeartbeat() {
  clearInterval(heartbeat);
  heartbeat = setInterval(() => { if (!document.hidden) { renderStatus(); void refresh(); } }, 30000);
}

restoreDraft(); renderList(); renderStatus(); renderInstall();
performance.mark('fex:controls-ready');
void (async () => {
  await rates.restore();
  performance.mark('fex:saved-rates-ready');
  void refresh();
  const savedCatalog = await storage.readCatalog();
  if (savedCatalog && savedCatalog.checkedAt > catalogCheckedAt) { catalogCheckedAt = savedCatalog.checkedAt; setCatalog(savedCatalog.items); }
  void updateCatalog();
})();
requestAnimationFrame(() => { void pwa.register(); });
startHeartbeat();
