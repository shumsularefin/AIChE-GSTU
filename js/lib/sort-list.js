// Sort controls for every growing list. Watches a root element and gives each list or table that has
// at least MIN items a small "Sort" dropdown: newest/oldest first (when items carry dates), A–Z and Z–A.
// Works on markup as it is: an item's date comes from data-sort-date or a <time datetime>, its name from
// data-sort-name or its first heading, link or cell. Lists repainted later keep the chosen order, and the
// choice is remembered per list in this browser. Add data-nosort to a list to leave it alone.

const MIN = 3;

/** Sort key helpers, exported for tests. */
export function itemDate(el) {
  return el.dataset.sortDate || el.querySelector('time[datetime]')?.getAttribute('datetime') || '';
}
export function itemName(el) {
  if (el.dataset.sortName) return el.dataset.sortName;
  const head = el.querySelector('h1, h2, h3, h4, strong, a, td, span');
  return (head || el).textContent.trim();
}

/** Returns the items in the requested order; 'default' keeps the original order. */
export function orderItems(items, mode, original = items) {
  const byName = (a, b) => itemName(a).localeCompare(itemName(b), undefined, { numeric: true, sensitivity: 'base' });
  const byDate = (a, b) => itemDate(a).localeCompare(itemDate(b));
  const list = [...original];
  if (mode === 'reverse') return list.reverse();
  if (mode === 'az') return list.sort(byName);
  if (mode === 'za') return list.sort(byName).reverse();
  if (mode === 'newest') return list.sort((a, b) => byDate(b, a));
  if (mode === 'oldest') return list.sort(byDate);
  return list;
}

// Size a Sort dropdown to its chosen option, so the arrow sits right after the text ("A to Z ⌄") instead
// of after the longest option. Browsers with CSS field-sizing do this themselves.
const fitsItself = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');
let ruler;
function fit(select) {
  if (fitsItself || !select.isConnected) return;
  const style = getComputedStyle(select);
  ruler ||= document.createElement('canvas').getContext('2d');
  if (!ruler) return;
  ruler.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const text = select.selectedOptions[0]?.textContent || '';
  select.style.width = `${Math.ceil(ruler.measureText(text).width) + 2}px`;
}
function keepFitted(select) {
  fit(select);
  select.addEventListener('change', () => fit(select));
  document.fonts?.ready.then(() => fit(select));
}

const store = {
  get(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

function enhance(list, index, { barClass, labelClass }) {
  list.dataset.sortReady = '';
  const items = () => [...list.children].filter((el) => !el.matches('[data-sort-fixed]'));
  const hasDates = () => items().some((el) => itemDate(el));
  const key = `sort:${location.pathname}${location.hash.split('/')[0]}:${index}`;
  let original = items();
  const bar = document.createElement('div');
  bar.className = barClass;
  const options = (dates) =>
    (dates
      ? [
          ['newest', 'Newest first'],
          ['oldest', 'Oldest first'],
        ]
      : [
          ['default', 'As listed'],
          ['reverse', 'Reverse order'],
        ]
    )
      .concat([
        ['az', 'A to Z'],
        ['za', 'Z to A'],
      ])
      .map(([v, t]) => `<option value="${v}">${t}</option>`)
      .join('');
  bar.innerHTML = `<label><span class="${labelClass}">Sort</span><select data-ignore aria-label="Sort this list">${options(hasDates())}</select></label>`;
  const select = bar.querySelector('select');
  const saved = store.get(key);
  if (saved && select.querySelector(`option[value="${saved}"]`)) select.value = saved;

  const watcher = new MutationObserver(() => {
    original = items();
    apply();
  });
  function apply() {
    watcher.disconnect();
    const ordered = orderItems(items(), select.value, original);
    for (const el of ordered) list.append(el);
    for (const el of [...list.children].filter((x) => x.matches('[data-sort-fixed]'))) list.prepend(el);
    watcher.observe(list, { childList: true });
  }
  select.addEventListener('change', () => {
    store.set(key, select.value);
    apply();
  });
  const anchor = list.matches('tbody') ? list.closest('.ed-table-wrap') || list.closest('table') : list;
  anchor.before(bar);
  keepFitted(select);
  if (select.value === 'default') watcher.observe(list, { childList: true });
  else apply();
}

/**
 * Keeps sort controls on the lists inside root. selector picks candidate lists.
 * barClass/labelClass style the control for the page's design.
 */
export function autoSort(root, selector, { barClass = 'sort-bar', labelClass = 'sort-label' } = {}) {
  if (!root) return;
  let pending = false;
  const scan = () => {
    pending = false;
    let index = 0;
    for (const list of root.querySelectorAll(selector)) {
      index++;
      if (list.hasAttribute('data-sort-ready') || list.closest('[data-nosort]') || list.closest('dialog')) continue;
      if ([...list.children].filter((el) => !el.matches('[data-sort-fixed]')).length < MIN) continue;
      enhance(list, index, { barClass, labelClass });
    }
  };
  // Next frame, or shortly after when frames are paused (a background tab): whichever comes first.
  new MutationObserver(() => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(() => pending && scan());
      setTimeout(() => pending && scan(), 150);
    }
  }).observe(root, { childList: true, subtree: true });
  scan();
}

// ------------------------------------------------------------------ dropdowns
// Event dropdowns ("Title (YYYY-MM-DD)") get a small Sort choice under them. Options without a date
// (such as "Not linked to an event") stay at the top, and the current selection is kept.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ISO = /(\d{4}-\d{2}-\d{2})/;
const LONG = /(\d{1,2}) ([A-Za-z]+),? (\d{4})(?!.*\d{1,2} [A-Za-z]+,? \d{4})/;
/** An option's date: data-date, a YYYY-MM-DD, or a "30 September 2026" in its text (the last one wins). */
export function optionDate(o) {
  if (o.dataset?.date) return o.dataset.date;
  const text = o.textContent;
  const long = text.match(LONG);
  const month = long ? MONTHS.indexOf(long[2].toLowerCase()) : -1;
  if (month >= 0) return `${long[3]}-${String(month + 1).padStart(2, '0')}-${long[1].padStart(2, '0')}`;
  return text.match(ISO)?.[1] || '';
}
const DATED = { test: (text) => !!optionDate({ textContent: text }) };

/** Orders dated <option>s; exported for tests. */
export function orderOptions(options, mode) {
  const date = optionDate;
  const fixed = options.filter((o) => !date(o));
  const dated = options.filter((o) => date(o));
  const name = (a, b) => a.textContent.localeCompare(b.textContent, undefined, { numeric: true, sensitivity: 'base' });
  if (mode === 'oldest') dated.sort((a, b) => date(a).localeCompare(date(b)));
  else if (mode === 'az') dated.sort(name);
  else if (mode === 'za') dated.sort(name).reverse();
  else dated.sort((a, b) => date(b).localeCompare(date(a)));
  return [...fixed, ...dated];
}

let fieldCount = 0;
function enhanceSelect(select, className) {
  select.dataset.sortReady = '';
  const key = 'sort:event-dropdowns';
  const bar = document.createElement('span');
  bar.className = className;
  bar.innerHTML =
    'Sort <select data-ignore aria-label="Sort the events"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="az">A to Z</option><option value="za">Z to A</option></select>';
  const sorter = bar.querySelector('select');
  sorter.value = store.get(key) || 'newest';
  const apply = () => {
    const value = select.value;
    select.append(...orderOptions([...select.options], sorter.value));
    select.value = value;
  };
  sorter.addEventListener('change', () => {
    store.set(key, sorter.value);
    apply();
  });
  // Sit on the field's label line, aligned with its text; otherwise just after the dropdown.
  const text = select.previousElementSibling;
  if (text && !text.matches('select, input, textarea, button')) {
    // Keep the label's own words ("For event (optional)") together as one piece of the line.
    const words = document.createElement('span');
    words.append(...text.childNodes);
    text.append(words, bar);
    text.classList.add('has-sort');
    // The Sort choice now sits inside the field's <label> ahead of the event dropdown, which would make it
    // the label's control: tie the label to the event dropdown explicitly so clicks and screen readers
    // still reach it.
    const label = select.closest('label');
    if (label && label.contains(bar)) {
      select.id ||= `sort-field-${++fieldCount}`;
      label.htmlFor = select.id;
      words.id = `${select.id}-name`;
      if (!select.hasAttribute('aria-label') && !select.hasAttribute('aria-labelledby')) select.setAttribute('aria-labelledby', words.id);
    }
  } else select.after(bar);
  keepFitted(sorter);
  apply();
}

/** Adds the Sort choice to every event dropdown under root, now and later. */
export function autoSortSelects(root, className = 'sort-select') {
  if (!root) return;
  let pending = false;
  const scan = () => {
    pending = false;
    for (const select of root.querySelectorAll('select:not([data-ignore]):not([data-sort-ready])')) {
      if (select.closest('[data-nosort]')) continue;
      if ([...select.options].filter((o) => optionDate(o)).length >= 2) enhanceSelect(select, className);
    }
  };
  // Next frame, or shortly after when frames are paused (a background tab): whichever comes first.
  new MutationObserver(() => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(() => pending && scan());
      setTimeout(() => pending && scan(), 150);
    }
  }).observe(root, { childList: true, subtree: true });
  scan();
}
