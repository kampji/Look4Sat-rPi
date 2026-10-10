// Small DOM / formatting / widget helpers. No framework on purpose: it keeps the Pi snappy.
import { S } from './store.js';

// ------------------------------------------------------------------ DOM
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

/** Fast-tap: fire on pointerup if the finger didn't travel (lets lists scroll without accidental taps). */
export function onTap(el, fn) {
  let x = 0, y = 0, id = null, moved = false;
  el.addEventListener('pointerdown', (e) => { id = e.pointerId; x = e.clientX; y = e.clientY; moved = false; });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === id && Math.hypot(e.clientX - x, e.clientY - y) > 12) moved = true;
  });
  el.addEventListener('pointercancel', () => { id = null; });
  el.addEventListener('click', (e) => { if (!moved) fn(e); moved = false; });
  return el;
}

// ------------------------------------------------------------------ icons
const P = {
  satellite: '<path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4Z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/>',
  passes: '<path d="M8 6h13M8 12h13M8 18h13"/><rect x="3" y="5" width="2" height="2" rx=".5"/><rect x="3" y="11" width="2" height="2" rx=".5"/><rect x="3" y="17" width="2" height="2" rx=".5"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/><path d="M12 12 19 5"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkAll: '<path d="m2 12.5 4.5 4.5L16 7.5"/><path d="m12 16.5.5.5L22 7.5"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  squareCheck: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="m8 12 3 3 5-6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  gps: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".6" fill="currentColor"/>',
  antenna: '<path d="M12 12v10"/><circle cx="12" cy="10" r="2"/><path d="M7.8 5.8a6 6 0 0 0 0 8.4M16.2 5.8a6 6 0 0 1 0 8.4M5 3a10 10 0 0 0 0 14M19 3a10 10 0 0 1 0 14"/>',
  rotator: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5"/><path d="M12 12l3-3"/>',
  elev: '<path d="M3 20h18M3 20 18 6"/><path d="M11 20a8 8 0 0 0-2.4-5.6"/>',
  alt: '<path d="M6 3h12M6 21h12M12 6v12M9 9l3-3 3 3M9 15l3 3 3-3"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  backspace: '<path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m17 9-6 6M11 9l6 6"/>',
  shift: '<path d="M12 4 4 12h4v7h8v-7h4Z"/>',
  enter: '<path d="M20 5v7a3 3 0 0 1-3 3H5"/><path d="m9 11-4 4 4 4"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 7a8 8 0 1 0 11.4 0"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  iss: '<rect x="10" y="9" width="4" height="6" rx="1"/><path d="M2 6h5v12H2zM17 6h5v12h-5zM7 12h3M14 12h3M12 9V5M10 5h4"/>',
  home: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  auto: '<circle cx="12" cy="12" r="9.5"/><path d="M8.3 16.5 12 7l3.7 9.5M9.6 13.3h4.8"/>',
  follow: '<circle cx="12" cy="12" r="7.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  video: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'ic ' + cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || '';
  return s;
}
export const iconBtn = (name, onclick, attrs = {}) => {
  const b = h('button', { class: 'btn-icon ' + (attrs.class || ''), 'aria-label': attrs.label || name, title: attrs.label || name }, icon(name));
  onTap(b, onclick);
  return b;
};

// ------------------------------------------------------------------ formatting
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
const parts = (ms) => {
  const d = new Date(ms);
  return S.state?.display?.utc
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() }
    : { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), w: d.getDay(), h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
};
const is12 = () => S.state?.display?.clock24 === false;
const hh = (p) => (is12() ? String(((p.h + 11) % 12) + 1) : p2(p.h));
const ap = (p) => (is12() ? (p.h < 12 ? ' AM' : ' PM') : '');
export const fmtTime = (ms) => { const p = parts(ms); return `${hh(p)}:${p2(p.m)}:${p2(p.s)}${ap(p)}`; };
export const fmtHM = (ms) => { const p = parts(ms); return `${hh(p)}:${p2(p.m)}${ap(p)}`; };
/** Clock time for a minute-of-day (AOS window labels). */
export const fmtMinute = (min) => { const p = { h: Math.floor(min / 60) % 24, m: min % 60 }; return `${hh(p)}:${p2(p.m)}${ap(p)}`; };
export const fmtDate = (ms) => { const p = parts(ms); return `${DAYS[p.w]} ${p2(p.d)} ${MONTHS[p.mo]}`; };
export const fmtDateTime = (ms) => { const p = parts(ms); return `${p.y}-${p2(p.mo + 1)}-${p2(p.d)} ${fmtHM(ms)}`; };
export const fmtDayLong = (ms) => { const p = parts(ms); return `${DAYS[p.w]}, ${p2(p.d)} ${MONTHS[p.mo]} ${p.y}`; };
/** Start of the (local or UTC) calendar day containing ms. */
export function dayStart(ms) {
  const d = new Date(ms);
  return S.state?.display?.utc ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
export const fmtDuration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}m ${s % 60}s`; };

/** Look4Sat elevation colouring: red below the low threshold, accent in between, green above high. */
export function elClass(el) {
  const d = S.state?.display || {};
  if (!Number.isFinite(el)) return '';
  if (el < (d.elLow ?? 15)) return 'el-low';
  if (el < (d.elHigh ?? 45)) return 'el-mid';
  return 'el-high';
}
export function fmtCountdown(ms) {
  if (ms < 0) ms = 0;
  const t = Math.floor(ms / 1000);
  return `${p2(Math.floor(t / 3600))}:${p2(Math.floor((t % 3600) / 60))}:${p2(t % 60)}`;
}
export const fmtAz = (a) => String(Math.round(a) % 360).padStart(3, '0') + '°';
export const fmtDeg = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) + '°' : '--');
export const fmtKm = (v) => (Number.isFinite(v) ? Math.round(v) + ' km' : '--');
export const fmtMHz = (hz) => (hz ? (hz / 1e6).toFixed(4) : '--.----');
export function fmtAgo(sec) {
  if (!sec) return 'never';
  const d = Date.now() / 1000 - sec;
  if (d < 90) return 'just now';
  if (d < 5400) return Math.round(d / 60) + ' min ago';
  if (d < 129600) return Math.round(d / 3600) + ' h ago';
  return Math.round(d / 86400) + ' days ago';
}

// ------------------------------------------------------------------ toast
let toastTimer;
export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast' }); document.getElementById('app').append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ dialog
export function dialog({ title, body, actions = [], wide = false, onClose }) {
  const app = document.getElementById('app');
  const close = () => { scrim.remove(); osk.hide(); onClose && onClose(); };
  const box = h('div', { class: 'dialog' + (wide ? ' wide' : ''), role: 'dialog' });
  const head = h('div', { class: 'dialog-head' }, h('div', { class: 'dialog-title' }, title));
  const content = h('div', { class: 'dialog-body' });
  if (typeof body === 'function') body(content, close); else if (body) content.append(body);
  const foot = h('div', { class: 'dialog-actions' });
  for (const a of actions) {
    const b = h('button', { class: 'btn ' + (a.primary ? 'primary' : '') }, a.label);
    onTap(b, () => { const r = a.onClick && a.onClick(close); if (r !== false) close(); });
    foot.append(b);
  }
  if (!actions.length) {
    const b = h('button', { class: 'btn primary' }, 'Close');
    onTap(b, close);
    foot.append(b);
  }
  box.append(head, content, foot);
  const scrim = h('div', { class: 'scrim' }, box);
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) scrim.dataset.down = '1'; });
  scrim.addEventListener('click', (e) => { if (e.target === scrim && scrim.dataset.down) close(); });
  app.append(scrim);
  return { close, box, content };
}

export function confirmDialog(title, text, okLabel, onOk) {
  dialog({ title, body: h('p', { class: 'muted' }, text),
    actions: [{ label: 'Cancel' }, { label: okLabel, primary: true, onClick: onOk }] });
}

// ------------------------------------------------------------------ form widgets
export function toggle(checked, onchange) {
  const t = h('button', { class: 'switch' + (checked ? ' on' : ''), role: 'switch', 'aria-checked': String(!!checked) }, h('span'));
  onTap(t, () => {
    const on = !t.classList.contains('on');
    t.classList.toggle('on', on);
    t.setAttribute('aria-checked', String(on));
    onchange(on);
  });
  return t;
}

export function stepper(value, { min, max, step = 1, fmt = (v) => v, onchange }) {
  let v = value;
  const out = h('span', { class: 'stepper-val' }, fmt(v));
  const set = (nv) => {
    nv = Math.min(max, Math.max(min, Math.round(nv / step) * step));
    nv = Math.round(nv * 1000) / 1000;
    if (nv === v) return;
    v = nv; out.textContent = fmt(v); onchange(v);
  };
  const repeat = (btn, d) => {
    let timer, rep;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); set(v + d);
      timer = setTimeout(() => { rep = setInterval(() => set(v + d), 80); }, 400);
    });
    const stop = () => { clearTimeout(timer); clearInterval(rep); };
    btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', stop); btn.addEventListener('pointercancel', stop);
  };
  const minus = h('button', { class: 'btn-icon small', 'aria-label': 'decrease' }, icon('minus'));
  const plus = h('button', { class: 'btn-icon small', 'aria-label': 'increase' }, icon('plus'));
  repeat(minus, -step); repeat(plus, step);
  return h('span', { class: 'stepper' }, minus, out, plus);
}

export function segmented(options, value, onchange) {
  const wrap = h('span', { class: 'segmented' });
  for (const [val, label] of options) {
    const b = h('button', { class: val === value ? 'on' : '' }, label);
    onTap(b, () => { [...wrap.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); onchange(val); });
    wrap.append(b);
  }
  return wrap;
}

export function input(value, { placeholder = '', kind = 'text', oninput, onchange, cls = '' } = {}) {
  const el = h('input', {
    class: 'field ' + cls, value: value ?? '', placeholder, spellcheck: 'false', autocomplete: 'off',
    inputmode: kind === 'num' ? 'decimal' : 'text', 'data-osk': kind,
  });
  if (oninput) el.addEventListener('input', () => oninput(el.value));
  if (onchange) el.addEventListener('change', () => onchange(el.value));
  return el;
}

// ------------------------------------------------------------------ on-screen keyboard
// A built-in keyboard so the app is fully usable on a touchscreen with no physical keyboard.
export const osk = (() => {
  let panel = null, target = null, mode = 'alpha', shift = false, physical = false;
  const ROWS = {
    alpha: ['1234567890', 'qwertyuiop', 'asdfghjkl', '⇧zxcvbnm⌫', '#␣.-⏎'],
    sym: ['1234567890', '()[]/\\:;_', '@&+=*%$!?', "'\",<>⌫", 'A␣.-⏎'],
    num: ['789', '456', '123', '-0.', '⌫⏎'],
  };
  function enabled() { return S.state?.display?.osk !== false && !physical; }
  function press(k) {
    if (!target) return;
    if (k === '⏎') { const t = target; t.dispatchEvent(new Event('change', { bubbles: true })); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); t.blur(); return; }
    if (k === '⇧') { shift = !shift; render(); return; }
    if (k === '#') { mode = 'sym'; render(); return; }
    if (k === 'A') { mode = 'alpha'; render(); return; }
    const el = target;
    let s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
    if (k === '⌫') {
      if (s === e && s > 0) s -= 1;
      el.setRangeText('', s, e, 'end');
    } else {
      let ch = k === '␣' ? ' ' : k;
      if (shift) { ch = ch.toUpperCase(); shift = false; render(); }
      el.setRangeText(ch, s, e, 'end');
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function render() {
    if (!panel) return;
    panel.innerHTML = '';
    const rows = ROWS[mode];
    panel.className = 'osk ' + mode;
    for (const r of rows) {
      const row = h('div', { class: 'osk-row' });
      for (const k of r) {
        const label = { '⇧': icon('shift'), '⌫': icon('backspace'), '⏎': icon('enter'), '␣': 'space', '#': '?123', A: 'ABC' }[k]
          ?? (shift && mode === 'alpha' ? k.toUpperCase() : k);
        const b = h('button', { class: 'osk-key k-' + ({ '␣': 'space', '⏎': 'enter', '⌫': 'bs', '⇧': 'shift' + (shift ? ' on' : '') }[k] || 'ch') }, label);
        let rep, timer;
        b.addEventListener('pointerdown', (ev) => {
          ev.preventDefault(); press(k); b.classList.add('down');
          if (k === '⌫') timer = setTimeout(() => { rep = setInterval(() => press('⌫'), 70); }, 450);
        });
        const up = () => { b.classList.remove('down'); clearTimeout(timer); clearInterval(rep); };
        b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
        row.append(b);
      }
      panel.append(row);
    }
  }
  function show(el) {
    if (!enabled()) return;
    target = el;
    mode = el.dataset.osk === 'num' ? 'num' : 'alpha';
    shift = false;
    if (!panel) {
      panel = h('div', { class: 'osk' });
      panel.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
      document.getElementById('app').append(panel);
    }
    render();
    const app = document.getElementById('app');
    app.style.setProperty('--osk-h', Math.round(app.clientHeight * (mode === 'num' ? 0.42 : 0.46)) + 'px');
    app.classList.add('osk-open');
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
  }
  function hide() {
    target = null;
    if (panel) { panel.remove(); panel = null; }
    document.getElementById('app')?.classList.remove('osk-open');
  }
  document.addEventListener('focusin', (e) => { if (e.target.matches?.('input.field')) show(e.target); });
  document.addEventListener('focusout', (e) => { if (e.target === target) setTimeout(() => { if (document.activeElement !== target) hide(); }, 0); });
  // a real keyboard was used: stop popping the on-screen one up
  document.addEventListener('keydown', (e) => { if (e.isTrusted && e.key.length === 1 && target) { physical = true; hide(); } });
  return { show, hide };
})();

// ------------------------------------------------------------------ drag-to-scroll
// Makes mouse (and mouse-emulating touchscreens) scroll lists like a finger: click-and-drag with
// momentum. Real touch input keeps the browser's native scrolling.
/** Convert a screen-space delta into the app's own (possibly rotated) coordinates. */
export function toLocal(dx, dy) {
  switch (Number(S.state?.display?.rotate) || 0) {
    case 90: return [dy, -dx];
    case 180: return [-dx, -dy];
    case 270: return [-dy, dx];
    default: return [dx, dy];
  }
}
export const dragScroll = (() => {
  let st = null, anim = 0, suppressUntil = 0;
  const hooks = new Set(); // pull-to-refresh listeners: fn(scroller, pullPx, released)
  document.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim);
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (e.target.closest('input, canvas, .switch, .stepper, .segmented, .osk, iframe, .no-drag')) return;
    const sc = e.target.closest('.scroll, .dialog-body');
    if (!sc) return;
    st = { sc, x: e.clientX, y: e.clientY, top: sc.scrollTop, moved: false, samples: [], pull: 0 };
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (!st) return;
    const [, dy] = toLocal(e.clientX - st.x, e.clientY - st.y);
    if (!st.moved && Math.abs(dy) < 7) return;
    if (!st.moved) { st.moved = true; st.sc.classList.add('dragging'); }
    const want = st.top - dy;
    st.sc.scrollTop = want;
    st.pull = want < 0 ? -want : 0;
    if (st.pull) hooks.forEach((fn) => fn(st.sc, st.pull, false));
    const now = performance.now();
    st.samples.push([now, st.sc.scrollTop]);
    while (st.samples.length && now - st.samples[0][0] > 100) st.samples.shift();
  }, true);
  const end = () => {
    if (!st) return;
    const s = st; st = null;
    s.sc.classList.remove('dragging');
    if (!s.moved) return;
    suppressUntil = performance.now() + 80; // swallow the click that ends a drag
    hooks.forEach((fn) => fn(s.sc, s.pull, true));
    if (s.samples.length < 2) return;
    const [t0, y0] = s.samples[0], [t1, y1] = s.samples[s.samples.length - 1];
    let v = (y1 - y0) / Math.max(16, t1 - t0); // px per ms
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      s.sc.scrollTop += v * dt;
      v *= Math.pow(0.995, dt);
      if (Math.abs(v) > 0.02) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  document.addEventListener('click', (e) => {
    if (performance.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  return { onPull: (fn) => hooks.add(fn) };
})();
