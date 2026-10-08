import { S, on, emit, loadAll, requestPasses, tickPasses, api } from './store.js';
import { h, icon, onTap, toast } from './ui.js';
import satellitesView from './views/satellites.js';
import passesView from './views/passes.js';
import radarView from './views/radar.js';
import mapView from './views/map.js';
import settingsView from './views/settings.js';

const VIEWS = [satellitesView, passesView, radarView, mapView, settingsView];
const app = document.getElementById('app');
let current = null;

// ------------------------------------------------------------------ layout / scaling / rotation
// Works at any resolution: everything is sized in rem, and the root font size follows the
// short side of the screen (480 px -> 15 px). Layout switches between a side rail (landscape)
// and a bottom bar (portrait). The whole UI can also be rotated in software for displays that
// are mounted sideways.
export function applyLayout() {
  const d = S.state?.display || {};
  const rot = Number(d.rotate) || 0;
  const W = window.innerWidth, H = window.innerHeight;
  const swap = rot === 90 || rot === 270;
  const w = swap ? H : W, hgt = swap ? W : H;
  Object.assign(app.style, { width: w + 'px', height: hgt + 'px' });
  app.style.transform = {
    0: '', 90: `translateX(${W}px) rotate(90deg)`, 180: `translate(${W}px, ${H}px) rotate(180deg)`, 270: `translateY(${H}px) rotate(-90deg)`,
  }[rot] || '';
  const base = Math.max(10, Math.min(30, Math.min(w, hgt) / 32));
  document.documentElement.style.fontSize = (base * (Number(d.scale) || 1)).toFixed(2) + 'px';
  const portrait = d.layout === 'portrait' || (d.layout !== 'landscape' && hgt > w * 1.05);
  app.classList.toggle('portrait', portrait);
  app.classList.toggle('landscape', !portrait);
  document.documentElement.classList.toggle('night', !!d.night);
  document.documentElement.classList.toggle('no-cursor', !!d.hideCursor);
  emit('resize');
}
window.addEventListener('resize', applyLayout);
on('settings', (p) => { if (p && p.display) applyLayout(); });

// ------------------------------------------------------------------ navigation
const nav = h('nav', { class: 'nav' });
const viewsEl = h('main', { class: 'views' });

export function go(id, arg) {
  const v = VIEWS.find((x) => x.id === id);
  if (!v) return;
  if (current && current !== v) { current.el.classList.remove('active'); current.hide?.(); }
  current = v;
  v.el.classList.add('active');
  [...nav.children].forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  v.show?.(arg);
  try { localStorage.setItem('l4s.view', id); } catch { /* storage unavailable */ }
}
on('go', ({ id, arg }) => go(id, arg));

function buildNav() {
  for (const v of VIEWS) {
    const b = h('button', { class: 'nav-item', 'data-id': v.id }, h('span', { class: 'nav-pill' }, icon(v.icon)), h('span', { class: 'nav-label' }, v.label));
    onTap(b, () => go(v.id));
    nav.append(b);
  }
}

// ------------------------------------------------------------------ boot
async function boot() {
  app.append(viewsEl, nav);
  applyLayout();
  try {
    await loadAll();
  } catch (e) {
    app.innerHTML = '';
    app.append(h('div', { class: 'fatal' }, h('h2', {}, 'Cannot reach the Look4Sat rPi server'), h('p', {}, String(e.message || e)),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Retry')));
    setTimeout(() => location.reload(), 5000);
    return;
  }
  applyLayout();
  buildNav();
  for (const v of VIEWS) { v.el = h('section', { class: 'view view-' + v.id }); viewsEl.append(v.el); v.mount(v.el); }

  let start = 'passes';
  try { start = localStorage.getItem('l4s.view') || start; } catch { /* ignore */ }
  if (!S.catalog.length || !S.state.station.set) start = S.catalog.length ? 'settings' : 'satellites';
  go(start === 'radar' ? 'passes' : start);
  requestPasses(true);

  // one clock for the whole UI, aligned to the second
  const tick = () => {
    const now = Date.now();
    if (tickPasses(now)) emit('passes');
    current?.tick?.(now);
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  tick();

  // keep the passes fresh when the catalog is updated in the background (e.g. auto-update)
  setInterval(async () => {
    try {
      const u = await api('update');
      if (u.finished && u.finished !== S.meta.updated && !u.running) {
        const { reloadData } = await import('./store.js');
        await reloadData();
        toast('Satellite data updated');
      }
    } catch { /* server restarting */ }
  }, 60000);
}

// stop pinch-zoom / context menu / double-tap zoom in kiosk mode
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

boot();
