// Passes — mirrors the current Look4Sat Passes screen: search, modes filter, next-pass card,
// day groups with sunrise/sunset, AOS/LOS countdown chips, colour-coded elevation,
// pull-to-refresh and the full filter dialog (min elevation, time ahead, deep space,
// elevation highlight thresholds, AOS time window + invert).
import { S, on, emit, save, requestPasses } from '../store.js';
import { h, icon, iconBtn, onTap, dialog, stepper, toggle, input, fmtHM, fmtMinute, fmtDayLong, dayStart, dragScroll, toLocal, toast } from '../ui.js';
import { passCard, nextPassBox } from './common.js';
import { sunRiseSet } from '../predict.js';

const MAX_CARDS = 200;
const DEEP_LABEL = 'DeepSpace (period >225min)';
let root, list, nextBox, pull, searchEl, modesBtn;
let cards = [], query = '', shownKey = '';
const sunCache = new Map();

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
function matches(p) {
  const q = query.trim();
  if (!q) return true;
  if (/^\d+$/.test(q)) return p.id === Number(q);
  const name = norm(p.name);
  return q.split(/\s+/).map(norm).filter(Boolean).every((t) => name.includes(t));
}

function sunTimes(ms) {
  const st = S.state.station;
  const day = dayStart(ms);
  const key = `${day}|${st.lat}|${st.lon}|${S.state.display.utc}`;
  if (!sunCache.has(key)) sunCache.set(key, sunRiseSet(st, day));
  return sunCache.get(key);
}

function header(label, ms) {
  const { rise, set } = sunTimes(ms);
  return h('div', { class: 'day-head' },
    h('span', { class: 'accent' }, label),
    h('span', { class: 'sun' },
      h('span', {}, icon('sun', 'sm accent'), rise ? fmtHM(rise) : '--:--'),
      h('span', {}, icon('moon', 'sm'), set ? fmtHM(set) : '--:--')));
}

function render() {
  const now = Date.now();
  const passes = S.passes.filter(matches);
  list.innerHTML = '';
  cards = [];
  if (!passes.length) {
    const msg = S.passesBusy ? 'Calculating passes…'
      : query.trim() ? 'No upcoming passes match your search'
      : !S.catalog.length ? 'No satellite data yet. Update it from Settings → Satellite data.'
      : !(S.state.selection || []).length ? 'No satellites selected. Pick some on the Satellites screen.'
      : (S.state.passes.modes || []).length ? 'No passes for the selected modes. Check the modes filter.'
      : `No passes above ${S.state.passes.minElevation}° in the next ${S.state.passes.hoursAhead} h. Pull down to refresh.`;
    list.append(h('div', { class: 'empty' }, msg));
    return;
  }
  const frag = document.createDocumentFragment();
  let lastLabel = null;
  for (const p of passes.slice(0, MAX_CARDS)) {
    const label = p.deep ? DEEP_LABEL : fmtDayLong(p.aos);
    if (label !== lastLabel) { frag.append(header(label, p.deep ? now : p.aos)); lastLabel = label; }
    const c = passCard(p);
    onTap(c.el, () => { S.radarPass = p; emit('go', { id: 'radar', arg: p }); });
    c.update(now);
    cards.push(c);
    frag.append(c.el);
  }
  if (passes.length > MAX_CARDS) frag.append(h('div', { class: 'empty small span' }, `+ ${passes.length - MAX_CARDS} more passes — narrow them with search or the filter`));
  list.append(frag);
}

/** Look4Sat: the next pass is the first one still to rise (falls back to the last in the list). */
function upcoming(now) {
  const ps = S.passes.filter((p) => !p.deep && matches(p));
  return ps.find((p) => p.aos > now) || ps[ps.length - 1] || S.passes.find(matches) || null;
}

// ----------------------------------------------------------------- dialogs
function filterDialog() {
  const p = { ...S.state.passes };
  const d = { elLow: S.state.display.elLow ?? 15, elHigh: S.state.display.elHigh ?? 45 };
  const hoursFmt = (v) => (v < 24 ? `${v}h` : `${Math.floor(v / 24)}d${v % 24 ? ' ' + (v % 24) + 'h' : ''}`);
  const winLabel = h('span', { class: 'muted' });
  const updWin = () => { winLabel.textContent = p.invertAos ? `outside ${fmtMinute(p.aosStart)} – ${fmtMinute(p.aosEnd)}` : `${fmtMinute(p.aosStart)} – ${fmtMinute(p.aosEnd)}`; };
  p.aosStart ??= 0; p.aosEnd ??= 1439;
  updWin();
  const row = (label, ctrl, hint) => h('div', { class: 'frow' }, h('label', {}, label, hint ? h('div', { class: 'hint' }, hint) : null), ctrl);
  const minFmt = (v) => fmtMinute(Math.min(v, 1439));
  dialog({
    title: 'Filter passes', wide: true,
    body: h('div', { class: 'form two-col' },
      row('Minimal elevation', stepper(p.minElevation, { min: 0, max: 85, fmt: (v) => v + '°', onchange: (v) => (p.minElevation = v) })),
      row('Time ahead', stepper(p.hoursAhead, { min: 1, max: 240, fmt: hoursFmt, onchange: (v) => (p.hoursAhead = v) })),
      row('DeepSpace (period >225min)', toggle(p.showDeepSpace, (v) => (p.showDeepSpace = v))),
      h('div', { class: 'frow' }),
      row('Elevation highlight: low below', stepper(d.elLow, { min: 0, max: 60, fmt: (v) => v + '°', onchange: (v) => (d.elLow = v) }), h('span', { class: 'el-low' }, 'red')),
      row('Elevation highlight: high from', stepper(d.elHigh, { min: 10, max: 90, fmt: (v) => v + '°', onchange: (v) => (d.elHigh = v) }), h('span', { class: 'el-high' }, 'green')),
      row('AOS window from', stepper(p.aosStart, { min: 0, max: 1440 - 15, step: 15, fmt: minFmt, onchange: (v) => { p.aosStart = v; updWin(); } })),
      row('AOS window to', stepper(p.aosEnd === 1439 ? 1440 : p.aosEnd, { min: 15, max: 1440, step: 15, fmt: (v) => (v >= 1440 ? '24:00' : minFmt(v)), onchange: (v) => { p.aosEnd = Math.min(v, 1439); updWin(); } }), winLabel),
      row('Invert AOS window', toggle(p.invertAos, (v) => { p.invertAos = v; updWin(); }), 'Show passes outside the window instead')),
    actions: [
      { label: 'Reset', onClick: () => { save({ passes: { hoursAhead: 24, minElevation: 10, showDeepSpace: true, aosStart: 0, aosEnd: 1439, invertAos: false }, display: { elLow: 15, elHigh: 45 } }); requestPasses(true); } },
      { label: 'Cancel' },
      { label: 'Apply', primary: true, onClick: () => {
        if (d.elHigh <= d.elLow) d.elHigh = d.elLow + 1;
        save({ passes: p, display: d }, 'filter');
        requestPasses(true);
      } },
    ],
  });
}

function modesDialog() {
  const counts = new Map();
  for (const list of Object.values(S.radios)) {
    const seen = new Set();
    for (const r of list) for (const m of [r.m, r.um]) if (m && !seen.has(m)) { seen.add(m); counts.set(m, (counts.get(m) || 0) + 1); }
  }
  const all = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const pick = new Set(S.state.passes.modes || []);
  dialog({
    title: 'Select modes', wide: true,
    body: (c) => {
      if (!all.length) { c.append(h('p', { class: 'muted' }, 'No transmitter data yet — run a data update.')); return; }
      c.append(h('p', { class: 'hint' }, 'Only satellites with a transmitter in one of these modes get passes. Leave all unticked to show everything.'));
      const grid = h('div', { class: 'chk-grid' });
      all.forEach((m, i) => {
        const item = h('button', { class: 'chk-item' + (pick.has(m) ? ' on' : '') },
          h('span', { class: 'accent' }, `${i + 1}).`), h('span', { class: 'grow' }, m), h('span', { class: 'muted' }, counts.get(m)), h('span', { class: 'cb' }, icon('check')));
        onTap(item, () => { if (pick.has(m)) pick.delete(m); else pick.add(m); item.classList.toggle('on'); });
        grid.append(item);
      });
      c.append(grid);
    },
    actions: [
      { label: 'Clear', onClick: () => { save({ passes: { modes: [] } }); updateModesBtn(); requestPasses(true); } },
      { label: 'Cancel' },
      { label: 'Apply', primary: true, onClick: () => { save({ passes: { modes: [...pick] } }); updateModesBtn(); requestPasses(true); } },
    ],
  });
}
const updateModesBtn = () => modesBtn.classList.toggle('primary', !!(S.state.passes.modes || []).length);

// ----------------------------------------------------------------- pull to refresh
function setupPull() {
  const THRESH = 70;
  const show = (px, released) => {
    const v = Math.min(px, 110);
    pull.style.transform = `translate(-50%, ${v * 0.8 - 40}px) rotate(${v * 3}deg)`;
    pull.style.opacity = Math.min(1, v / THRESH);
    pull.classList.toggle('ready', v >= THRESH);
    if (released) {
      if (px >= THRESH) { requestPasses(true); toast('Recalculating passes…', 1200); }
      pull.style.transform = ''; pull.style.opacity = '';
      pull.classList.remove('ready');
    }
  };
  // touch: the list is native-scrolled, so watch overscroll at the top
  let start = null, px = 0;
  list.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start = list.scrollTop <= 0 && e.touches.length === 1 ? [t.clientX, t.clientY] : null;
    px = 0;
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    px = toLocal(t.clientX - start[0], t.clientY - start[1])[1];
    show(px > 0 && list.scrollTop <= 0 ? px : 0, false);
  }, { passive: true });
  list.addEventListener('touchend', () => { if (start) show(px, true); start = null; });
  // mouse drag (see ui.js dragScroll)
  dragScroll.onPull((sc, amount, released) => { if (sc === list) show(amount, released); });
}

export default {
  id: 'passes', label: 'Passes', icon: 'passes',
  mount(el) {
    root = el;
    nextBox = nextPassBox();
    onTap(nextBox.el, () => { const p = upcoming(Date.now()); if (p) { S.radarPass = p; emit('go', { id: 'radar', arg: p }); } });
    searchEl = input('', { placeholder: 'Search passes', oninput: (v) => { query = v; render(); } });
    const clear = iconBtn('close', () => { searchEl.value = ''; query = ''; render(); }, { label: 'Clear search', class: 'flat' });
    modesBtn = iconBtn('antenna', modesDialog, { label: 'Modes' });
    updateModesBtn();
    el.append(
      h('div', { class: 'topbar passes-bar' },
        modesBtn,
        h('div', { class: 'tile search' }, icon('search'), searchEl, clear),
        nextBox.el,
        iconBtn('filter', filterDialog, { label: 'Filter' })),
      h('div', { class: 'list-wrap' },
        pull = h('div', { class: 'pull' }, icon('refresh')),
        list = h('div', { class: 'scroll grid passes-grid' })),
    );
    setupPull();
    on('passes', () => { root.classList.remove('busy'); render(); this.tick(Date.now()); });
    on('passes-busy', () => { root.classList.add('busy'); if (!S.passes.length) render(); });
    on('settings', (p) => { if (p && p.display && ['utc', 'clock24', 'elLow', 'elHigh'].some((k) => k in p.display)) { sunCache.clear(); render(); shownKey = ''; } if (p?.station) sunCache.clear(); });
    on('filter', () => render());
    render();
  },
  show() { updateModesBtn(); },
  tick(now) {
    const p = upcoming(now);
    const key = p ? `${p.id}|${p.aos}|${S.state.display.clock24}|${S.state.display.utc}` : '';
    if (key !== shownKey) { shownKey = key; nextBox.update(null, now); }
    nextBox.update(p, now);
    for (const c of cards) c.update(now);
  },
};
