import { S, on, emit, save, requestPasses, api, reloadData } from '../store.js';
import { h, icon, iconBtn, onTap, dialog, input, toast, fmtDateTime, fmtMHz, fmtDeg } from '../ui.js';
import { makeSatrec, elements } from '../orbit.js';

let root, listEl, spacer, typeBtn, typeLbl, typeSub, searchEl;
let rows = [];           // filtered catalog entries
let pool = [];           // recycled row elements
let rowH = 48;
let query = '';
let types = new Set();   // active category filters ('★' = selected only)
let selection = new Set();
let dirty = false;

const SELECTED = '★ Selected';

function applyFilter() {
  const q = query.trim().toLowerCase();
  const isNum = /^\d+$/.test(q);
  rows = S.catalog.filter((e) => {
    if (types.size) {
      let ok = false;
      for (const t of types) {
        if (t === SELECTED ? selection.has(e.id) : e.cat && e.cat.includes(t)) { ok = true; break; }
      }
      if (!ok) return false;
    }
    if (!q) return true;
    if (isNum) return String(e.id).startsWith(q);
    return e.name.toLowerCase().includes(q) || String(e.id).includes(q);
  });
  spacer.style.height = rows.length * rowH + 'px';
  listEl.scrollTop = Math.min(listEl.scrollTop, Math.max(0, rows.length * rowH - listEl.clientHeight));
  updateTypeButton();
  draw(true);
}

function updateTypeButton() {
  typeLbl.textContent = 'Type: ' + (types.size === 0 ? 'All' : types.size === 1 ? [...types][0] : `${types.size} types`);
  typeSub.textContent = `${selection.size} selected · ${rows.length} shown`;
}

function measure() {
  rowH = Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 3.1);
  spacer.style.height = rows.length * rowH + 'px';
}

let raf = 0;
function draw(force) {
  if (raf && !force) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    raf = 0;
    const top = listEl.scrollTop;
    const first = Math.max(0, Math.floor(top / rowH) - 4);
    const count = Math.ceil(listEl.clientHeight / rowH) + 8;
    while (pool.length < count) {
      const r = h('div', { class: 'sat-row' },
        h('span', { class: 'sat-title' }, h('span', { class: 'accent' }), ' - ', h('span', { class: 'name' })),
        h('button', { class: 'sat-info btn-icon small', 'aria-label': 'Details' }, icon('info')),
        h('span', { class: 'cb' }, icon('check')));
      onTap(r, (e) => {
        const entry = rows[r._idx];
        if (!entry) return;
        if (e.target.closest('.sat-info')) { details(entry); return; }
        toggleSel(entry.id);
        paint(r, entry);
      });
      spacer.append(r);
      pool.push(r);
    }
    for (let i = 0; i < pool.length; i++) {
      const r = pool[i];
      const idx = first + i;
      const entry = rows[idx];
      if (!entry || i >= count) { r.style.display = 'none'; r._idx = -1; continue; }
      r.style.display = '';
      r._idx = idx;
      r.style.transform = `translateY(${idx * rowH}px)`;
      r.style.height = rowH + 'px';
      paint(r, entry);
    }
  });
}

function paint(r, entry) {
  r.querySelector('.accent').textContent = entry.id;
  r.querySelector('.name').textContent = entry.name;
  r.classList.toggle('sel', selection.has(entry.id));
}

function toggleSel(id) {
  if (selection.has(id)) selection.delete(id); else selection.add(id);
  commit();
}

function commit() {
  dirty = true;
  updateTypeButton();
  save({ selection: [...selection] }, 'selection');
}

function setAll(on, confirmed = false) {
  if (on && rows.length > 400 && !confirmed) {
    dialog({ title: `Select ${rows.length} satellites?`,
      body: h('p', { class: 'muted' }, 'Predicting passes for this many satellites can take a while on a Raspberry Pi. Narrow the list with Type or search first, or continue anyway.'),
      actions: [{ label: 'Cancel' }, { label: 'Select all', primary: true, onClick: () => setAll(true, true) }] });
    return;
  }
  if (on) rows.forEach((e) => selection.add(e.id));
  else rows.forEach((e) => selection.delete(e.id));
  commit();
  draw(true);
  toast(on ? `Selected ${rows.length} satellites` : `Cleared ${rows.length} satellites`);
}

function typeDialog() {
  const cats = [SELECTED, ...(S.meta.categories || [])];
  const counts = {};
  for (const e of S.catalog) for (const c of e.cat || []) counts[c] = (counts[c] || 0) + 1;
  const pick = new Set(types);
  dialog({
    title: 'Satellite type',
    wide: true,
    body: (c) => {
      const grid = h('div', { class: 'chk-grid' });
      cats.forEach((t, i) => {
        const n = t === SELECTED ? selection.size : counts[t] || 0;
        if (t !== SELECTED && !n) return;
        const item = h('button', { class: 'chk-item' + (pick.has(t) ? ' on' : '') },
          h('span', { class: 'accent' }, `${i + 1}).`), h('span', { class: 'grow' }, t), h('span', { class: 'muted' }, n), h('span', { class: 'cb' }, icon('check')));
        onTap(item, () => { if (pick.has(t)) pick.delete(t); else pick.add(t); item.classList.toggle('on'); });
        grid.append(item);
      });
      if (cats.length === 1) grid.append(h('p', { class: 'muted' }, 'Categories appear after a data update with "Fetch categories" enabled.'));
      c.append(grid);
    },
    actions: [{ label: 'All types', onClick: () => { types = new Set(); applyFilter(); } },
      { label: 'Apply', primary: true, onClick: () => { types = pick; applyFilter(); } }],
  });
}

export function details(entry) {
  const rec = makeSatrec(entry);
  const el = rec ? elements(rec) : null;
  const radios = S.radios[entry.id] || [];
  const age = el ? (Date.now() - el.epoch) / 86400000 : NaN;
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v));
  dialog({
    title: `${entry.id} - ${entry.name}`,
    wide: true,
    body: h('div', { class: 'details' },
      h('div', { class: 'kv-grid' },
        el ? [
          kv('Period', el.period.toFixed(1) + ' min'),
          kv('Inclination', fmtDeg(el.incl, 2)),
          kv('Apogee', Math.round(el.apogee) + ' km'),
          kv('Perigee', Math.round(el.perigee) + ' km'),
          kv('Eccentricity', el.ecc.toFixed(5)),
          kv('Epoch', fmtDateTime(el.epoch)),
          kv('Element age', h('span', { class: age > 14 ? 'warn' : '' }, age.toFixed(1) + ' days')),
          kv('Source', entry.src || '-'),
        ] : kv('Elements', 'invalid')),
      entry.cat ? h('div', { class: 'chips' }, entry.cat.map((c) => h('span', { class: 'chip' }, c))) : null,
      radios.length ? h('div', { class: 'tx-mini' }, h('div', { class: 'muted' }, `Transmitters (${radios.length})`),
        radios.map((r) => h('div', { class: 'tx-mini-row' }, h('span', {}, r.d || 'Transmitter'),
          h('span', { class: 'accent' }, r.dl ? 'D ' + fmtMHz(r.dl) : ''), h('span', {}, r.ul ? 'U ' + fmtMHz(r.ul) : ''), h('span', { class: 'muted' }, r.m || '')))) : null),
    actions: [
      { label: selection.has(entry.id) ? 'Deselect' : 'Select', onClick: () => { toggleSel(entry.id); draw(true); } },
      { label: 'Show on map', onClick: () => { if (!selection.has(entry.id)) { toggleSel(entry.id); draw(true); } S.mapSatId = entry.id; emit('go', { id: 'map' }); } },
      { label: 'Close', primary: true },
    ],
  });
}

function emptyState() {
  const btn = h('button', { class: 'btn primary' }, 'Download satellite data');
  const msg = h('p', { class: 'muted' }, 'Fetches elements from CelesTrak, AMSAT and SatNOGS. Takes about a minute.');
  const watch = () => {
    btn.disabled = true;
    const poll = setInterval(async () => {
      const u = await api('update').catch(() => null);
      if (!u) return;
      msg.textContent = `${Math.round(u.progress)}% · ${u.message}`;
      if (!u.running) {
        clearInterval(poll);
        btn.disabled = false;
        if (u.error && !u.finished) { msg.textContent = 'Update failed: ' + u.error; return; }
        await reloadData();
      }
    }, 1000);
  };
  onTap(btn, async () => {
    try { await api('update', { method: 'POST' }); } catch (e) { toast(e.message); return; }
    watch();
  });
  api('update').then((u) => { if (u.running) watch(); }).catch(() => {});
  return h('div', { class: 'empty big' }, h('h3', {}, 'No satellite data yet'), msg, btn);
}

export default {
  id: 'satellites', label: 'Satellites', icon: 'satellite',
  mount(el) {
    root = el;
    selection = new Set(S.state.selection || []);
    typeLbl = h('span', { class: 'type-lbl' });
    typeSub = h('span', { class: 'type-sub' });
    typeBtn = h('button', { class: 'tile type-btn' }, h('span', { class: 'hash accent' }, '#'), h('span', { class: 'type-text' }, typeLbl, typeSub), icon('down', 'sm'));
    onTap(typeBtn, typeDialog);
    searchEl = input('', { placeholder: 'Id - Name', oninput: (v) => { query = v; applyFilter(); } });
    const clear = iconBtn('close', () => { searchEl.value = ''; query = ''; applyFilter(); }, { label: 'Clear search', class: 'flat' });
    const search = h('div', { class: 'tile search' }, icon('search'), searchEl, clear);
    const done = iconBtn('checkAll', () => { emit('go', { id: 'passes' }); }, { label: 'Done', class: 'primary' });
    el.append(
      h('div', { class: 'topbar sat-bar' }, typeBtn, search,
        iconBtn('square', () => setAll(false), { label: 'Deselect shown' }),
        iconBtn('squareCheck', () => setAll(true), { label: 'Select shown' }), done),
      listEl = h('div', { class: 'scroll vlist' }, spacer = h('div', { class: 'vspacer' })),
    );
    listEl.addEventListener('scroll', () => draw(), { passive: true });
    on('resize', () => { measure(); draw(true); });
    on('catalog', () => { this.refresh(); });
    this.refresh();
  },
  refresh() {
    root.querySelector('.empty')?.remove();
    listEl.style.display = S.catalog.length ? '' : 'none';
    if (!S.catalog.length) { root.append(emptyState()); updateTypeButton(); return; }
    selection = new Set(S.state.selection || []);
    measure();
    applyFilter();
  },
  show() { selection = new Set(S.state.selection || []); measure(); draw(true); updateTypeButton(); },
  hide() {
    if (dirty) { dirty = false; requestPasses(true); }
  },
};
