import { OTHER_UNIT_CODES } from './catalog.js';
import { normalizeSearch } from './domain.js';

/** Keep picker controls stable across searches, reopening, and catalog updates.
 * @param {{container:HTMLElement,renderBadge:(element:HTMLElement,code:string)=>void,mode?:'multiple'|'single'}} options */
export function createCurrencyPicker({ container, renderBadge, mode = 'multiple' }) {
  /** @type {Map<string, ReturnType<typeof createRow>>} */
  const rows = new Map();
  const compareNames = new Intl.Collator().compare;
  const heading = document.createElement('p');
  heading.className = 'picker-group';
  heading.textContent = 'Other supported units';
  /** @type {{element:HTMLLabelElement,next:ChildNode|null}|null} */
  let promoted = null;

  function preserveFocus(action) {
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const scrollTop = container.scrollTop;
    action();
    if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
    container.scrollTop = scrollTop;
  }

  function restoreOrder() {
    if (!promoted) return;
    container.insertBefore(promoted.element, promoted.next);
    promoted = null;
  }

  function createRow(code) {
    const element = document.createElement('label'); element.className = 'picker-option';
    const mark = document.createElement('span'); mark.className = 'currency-badge'; mark.setAttribute('aria-hidden', 'true');
    renderBadge(mark, code);
    const identity = document.createElement('span'); identity.className = 'identity-copy';
    const codeLabel = document.createElement('span'); codeLabel.className = 'currency-code'; codeLabel.textContent = code;
    const name = document.createElement('span'); name.className = 'currency-name';
    const note = document.createElement('span'); note.className = 'picker-note';
    const input = document.createElement('input'); input.type = mode === 'single' ? 'radio' : 'checkbox'; input.value = code; input.name = mode === 'single' ? 'chart-currency' : 'currency';
    identity.append(codeLabel, name);
    element.append(mark, identity, note, input);
    return { element, input, name, note, search: '', unit: '' };
  }

  return {
    /** @param {import('./data.js').Currency[]} catalog */
    setCatalog(catalog) {
      preserveFocus(() => {
        restoreOrder();
        const codes = new Set(catalog.map(item => item.code));
        for (const [code, row] of rows) if (!codes.has(code)) { row.element.remove(); rows.delete(code); }
        const ordered = [...catalog].sort((a, b) => Number(OTHER_UNIT_CODES.has(a.code)) - Number(OTHER_UNIT_CODES.has(b.code)) || compareNames(a.name, b.name));
        const elements = [];
        let hasOther = false;
        for (const item of ordered) {
          const other = OTHER_UNIT_CODES.has(item.code);
          if (other && !hasOther) { elements.push(heading); hasOther = true; }
          const row = rows.get(item.code) || createRow(item.code);
          if (row.name.textContent !== item.name) row.name.textContent = item.name;
          row.input.setAttribute('aria-label', `${mode === 'single' ? 'Select' : 'Add'} ${item.code}, ${item.name}`);
          row.search = normalizeSearch(`${item.code} ${item.name} ${item.symbol}`);
          row.unit = other ? item.symbol || 'Reference unit' : '';
          rows.set(item.code, row);
          elements.push(row.element);
        }
        if (!hasOther) heading.remove();
        elements.forEach((element, index) => {
          if (container.children[index] !== element) container.insertBefore(element, container.children[index] || null);
        });
      });
    },
    /** @param {{search:string,codes:string[],selected:Set<string>,rates:import('./domain.js').Rates|null}} options */
    render({ search, codes, selected, rates }) {
      const addedCodes = new Set(codes);
      let visible = 0, otherVisible = false;
      for (const [code, row] of rows) {
        const added = addedCodes.has(code);
        const hidden = search !== '' && !row.search.includes(search);
        const checked = added || selected.has(code);
        const note = [row.unit, added ? 'Added' : rates && !rates[code] ? 'Rate unavailable' : ''].filter(Boolean).join(' · ');
        if (row.element.hidden !== hidden) row.element.hidden = hidden;
        if (row.element.dataset.added !== String(added)) row.element.dataset.added = String(added);
        if (row.input.disabled !== added) row.input.disabled = added;
        if (row.input.checked !== checked) row.input.checked = checked;
        if (row.note.textContent !== note) row.note.textContent = note;
        if (!hidden) { visible++; if (OTHER_UNIT_CODES.has(code)) otherVisible = true; }
      }
      const exact = rows.get(search.toUpperCase());
      if (promoted?.element !== exact?.element) preserveFocus(() => {
        restoreOrder();
        if (exact && container.firstElementChild !== exact.element) {
          promoted = { element: exact.element, next: exact.element.nextSibling };
          container.prepend(exact.element);
        }
      });
      const hideHeading = !!search || !otherVisible;
      if (heading.hidden !== hideHeading) heading.hidden = hideHeading;
      return visible;
    },
  };
}
