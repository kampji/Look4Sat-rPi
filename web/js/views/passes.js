import { S, on, emit, save, requestPasses, nextPass } from '../store.js';
import { h, iconBtn, onTap, dialog, stepper, toggle } from '../ui.js';
import { timerBox, passCard } from './common.js';

const MAX_CARDS = 150;
let list, timer, cards = [], status, refreshBtn;

function render() {
  list.innerHTML = '';
  cards = [];
  const now = Date.now();
  const passes = S.passes;
  if (!passes.length) {
    const msg = S.passesBusy ? 'Calculating passes…'
      : !S.catalog.length ? 'No satellite data yet. Update it from Settings → Data.'
      : !(S.state.selection || []).length ? 'No satellites selected. Pick some on the Satellites screen.'
      : `No passes above ${S.state.passes.minElevation}° in the next ${S.state.passes.hoursAhead} h.`;
    list.append(h('div', { class: 'empty' }, msg));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const p of passes.slice(0, MAX_CARDS)) {
    const c = passCard(p);
    onTap(c.el, () => { S.radarPass = p; emit('go', { id: 'radar', arg: p }); });
    c.update(now);
    cards.push(c);
    frag.append(c.el);
  }
  if (passes.length > MAX_CARDS) frag.append(h('div', { class: 'empty small' }, `+ ${passes.length - MAX_CARDS} more passes`));
  list.append(frag);
}

function filterDialog() {
  const p = { ...S.state.passes };
  dialog({
    title: 'Pass filter',
    body: h('div', { class: 'form' },
      h('div', { class: 'frow' }, h('label', {}, 'Hours ahead'),
        stepper(p.hoursAhead, { min: 1, max: 240, step: 1, fmt: (v) => v + ' h', onchange: (v) => (p.hoursAhead = v) })),
      h('div', { class: 'frow' }, h('label', {}, 'Min elevation'),
        stepper(p.minElevation, { min: 0, max: 85, step: 1, fmt: (v) => v + '°', onchange: (v) => (p.minElevation = v) })),
      h('div', { class: 'frow' }, h('label', {}, 'Show deep-space (GEO/HEO) satellites'),
        toggle(p.showDeepSpace, (v) => (p.showDeepSpace = v)))),
    actions: [{ label: 'Cancel' }, { label: 'Apply', primary: true, onClick: () => { save({ passes: p }, 'filter'); requestPasses(true); } }],
  });
}

export default {
  id: 'passes', label: 'Passes', icon: 'passes',
  mount(el) {
    timer = timerBox();
    refreshBtn = iconBtn('refresh', () => { requestPasses(true); }, { label: 'Recalculate' });
    status = h('div', { class: 'statusline' });
    el.append(
      h('div', { class: 'topbar' }, iconBtn('filter', filterDialog, { label: 'Filter' }), timer.el, refreshBtn),
      list = h('div', { class: 'scroll grid passes-grid' }),
    );
    on('passes', () => { refreshBtn.classList.remove('spin'); render(); this.tick(Date.now()); });
    on('passes-busy', () => { refreshBtn.classList.add('spin'); if (!S.passes.length) render(); });
    on('settings', (p) => { if (p && p.display && 'utc' in p.display) render(); });
    render();
  },
  tick(now) {
    const p = nextPass(now);
    timer.update(p, now);
    for (const c of cards) c.update(now);
  },
};
