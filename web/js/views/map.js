import { S, on, emit, nextPass, selectedEntries } from '../store.js';
import { h, iconBtn, toast, fmtDeg, fmtKm, elClass } from '../ui.js';
import { timerBox } from './common.js';
import { makeSatrec, observer, look, groundTrack, footprint, subSolar, toQth, periodMin, isDeepSpace, RAD, DEG } from '../orbit.js';

let canvas, ctx, baseCanvas, wrap, timer, info = {}, followBtn, homeBtn, autoBtn;
let W = 0, H = 0, dpr = 1;
let view = { lon: 0, lat: 0, k: 0 };        // center + pixels per degree
let world = null, baseDirty = true;
let recs = new Map();                        // id -> satrec for all sats on the map
let positions = [];                          // [{id, name, lat, lon, alt}]
let selId = null, selTrack = [], trackAt = 0, cur = null;
let follow = true, visible = false, rafPending = false;
let auto = false, autoPass = null;            // auto-track: follow the current/next pass until LOS
let C = {};

// ----------------------------------------------------------------- data
async function loadWorld() {
  const raw = await (await fetch('assets/world.json')).json();
  const conv = (rings) => rings.map((r) => {
    const a = new Float32Array(r);
    let mn = 999, mx = -999;
    for (let i = 0; i < a.length; i += 2) { mn = Math.min(mn, a[i]); mx = Math.max(mx, a[i]); }
    return { a, mn, mx };
  });
  world = { land: conv(raw.land), lakes: conv(raw.lakes), borders: conv(raw.borders) };
  baseDirty = true;
  requestDraw();
}

function rebuildRecs() {
  recs = new Map();
  const ents = S.state.display.mapAll ? selectedEntries() : [];
  if (selId && !ents.find((e) => e.id === selId) && S.byId.get(selId)) ents.push(S.byId.get(selId));
  for (const e of ents) { const r = makeSatrec(e); if (r) recs.set(e.id, r); }
  if (!selId || !recs.has(selId)) selId = recs.keys().next().value ?? null;
  trackAt = 0;
}

function ids() { return [...recs.keys()]; }

function cycle(d) {
  const list = ids();
  if (!list.length) return;
  const i = list.indexOf(selId);
  select(list[(i + d + list.length) % list.length]);
}

function ensureRec(id) {
  if (!recs || recs.has(id)) return;
  const e = S.byId.get(id);
  const r = e && makeSatrec(e);
  if (r) recs.set(id, r);
}

function select(id, fromAuto = false) {
  if (!fromAuto && auto) setAuto(false, true);
  ensureRec(id);
  selId = id;
  S.mapSatId = id;
  trackAt = 0;
  follow = true;
  followBtn.classList.add('primary');
  if (!fromAuto) update(Date.now());
}

// ----------------------------------------------------------------- auto-track
/** The pass to watch: one in progress (earliest to rise), else the next to rise. */
function pickAutoPass(now) {
  let best = null;
  for (const p of S.passes) {
    if (p.deep || p.los <= now) continue;
    if (!best || p.aos < best.aos) best = p;
  }
  return best;
}
function runAuto(now) {
  if (!auto) return;
  if (!autoPass || autoPass.los <= now || !S.passes.includes(autoPass)) {
    const prev = autoPass;
    autoPass = pickAutoPass(now);
    if (autoPass && (!prev || autoPass.id !== prev.id || autoPass.aos !== prev.aos)) {
      if (prev) toast(`Auto-track: next up ${autoPass.name}`);
      select(autoPass.id, true);
      if (view.k < minK() * 1.5) view.k = minK() * 2;
    }
  }
}
function setAuto(v, quiet) {
  auto = v; autoPass = null;
  autoBtn.classList.toggle('primary', v);
  if (v) {
    setFollow(true);
    runAuto(Date.now());
    if (!quiet) toast(autoPass ? `Auto-track on: ${autoPass.name} until LOS, then the next pass` : 'Auto-track on: waiting for the next pass');
  } else if (!quiet) toast('Auto-track off');
  if (visible) update(Date.now());
}

// ----------------------------------------------------------------- projection
const minK = () => Math.max(W / 360, H / 180);
function clampView() {
  view.k = Math.min(Math.max(view.k || minK(), minK()), minK() * 16);
  const half = H / 2 / view.k;
  view.lat = Math.min(90 - half, Math.max(-90 + half, view.lat));
  view.lon = ((((view.lon + 180) % 360) + 360) % 360) - 180;
}
const X = (lon) => W / 2 + (lon - view.lon) * view.k;
const Y = (lat) => H / 2 - (lat - view.lat) * view.k;

/** Offsets (multiples of 360) at which a feature spanning [mn, mx] longitude is visible. */
function copies(mn, mx) {
  const halfW = W / 2 / view.k;
  const vmin = view.lon - halfW, vmax = view.lon + halfW;
  const out = [];
  for (let n = Math.floor((vmin - mx) / 360); n <= Math.ceil((vmax - mn) / 360); n++) {
    if (mx + n * 360 >= vmin && mn + n * 360 <= vmax) out.push(n * 360);
  }
  return out;
}

function pathFlat(c, ring, off, close) {
  const a = ring.a;
  c.moveTo(X(a[0] + off), Y(a[1]));
  for (let i = 2; i < a.length; i += 2) c.lineTo(X(a[i] + off), Y(a[i + 1]));
  if (close) c.closePath();
}

function pathPts(c, pts, close) {
  let mn = Infinity, mx = -Infinity;
  for (const p of pts) { mn = Math.min(mn, p[1]); mx = Math.max(mx, p[1]); }
  for (const off of copies(mn, mx)) {
    pts.forEach((p, i) => (i ? c.lineTo(X(p[1] + off), Y(p[0])) : c.moveTo(X(p[1] + off), Y(p[0]))));
    if (close) c.closePath();
  }
}

// ----------------------------------------------------------------- drawing
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  C = { ocean: v('--map-ocean'), land: v('--map-land'), border: v('--map-border'), grid: v('--map-grid'),
    accent: v('--accent'), red: v('--red'), text: v('--text'), bg: v('--bg'), muted: v('--muted') };
}

function drawBase() {
  const b = baseCanvas.getContext('2d');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.fillStyle = C.ocean; b.fillRect(0, 0, W, H);
  // graticule
  b.strokeStyle = C.grid; b.lineWidth = 1; b.beginPath();
  const halfW = W / 2 / view.k;
  for (let lon = Math.ceil((view.lon - halfW) / 30) * 30; lon <= view.lon + halfW; lon += 30) { b.moveTo(Math.round(X(lon)) + 0.5, 0); b.lineTo(Math.round(X(lon)) + 0.5, H); }
  for (let lat = -60; lat <= 60; lat += 30) { b.moveTo(0, Math.round(Y(lat)) + 0.5); b.lineTo(W, Math.round(Y(lat)) + 0.5); }
  b.stroke();
  if (!world) return;
  b.fillStyle = C.land; b.beginPath();
  for (const r of world.land) for (const off of copies(r.mn, r.mx)) pathFlat(b, r, off, true);
  b.fill();
  b.fillStyle = C.ocean; b.beginPath();
  for (const r of world.lakes) for (const off of copies(r.mn, r.mx)) pathFlat(b, r, off, true);
  b.fill();
  b.strokeStyle = C.border; b.lineWidth = 0.8; b.beginPath();
  for (const r of world.borders) for (const off of copies(r.mn, r.mx)) pathFlat(b, r, off, false);
  b.stroke();
  baseDirty = false;
}

/** Terminator for sun altitude h (deg): polygon of the region where the sun is below h. */
function nightPoly(sun, hDeg) {
  const flip = sun.lat < 0;
  const dec = Math.max(0.05, Math.abs(sun.lat)) * RAD;
  const sh = Math.sin(hDeg * RAD);
  const pts = [];
  for (let lon = sun.lon - 180; lon <= sun.lon + 180.001; lon += 3) {
    const HA = (lon - sun.lon) * RAD;
    const A = Math.sin(dec), B = Math.cos(dec) * Math.cos(HA);
    const R = Math.hypot(A, B), psi = Math.atan2(B, A);
    let lat = (Math.asin(Math.max(-1, Math.min(1, sh / R))) - psi) * DEG;
    lat = Math.max(-90, Math.min(90, lat));
    pts.push([flip ? -lat : lat, lon]);
  }
  const pole = flip ? 90 : -90;
  pts.push([pole, sun.lon + 180], [pole, sun.lon - 180]);
  return pts;
}

function draw() {
  rafPending = false;
  if (!visible || !W) return;
  if (baseDirty) drawBase();
  const now = Date.now();
  const d = S.state.display;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (d.mapNight) {
    const sun = subSolar(now);
    for (const [hd, a] of [[0, 0.14], [-6, 0.09], [-12, 0.08], [-18, 0.08]]) {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.beginPath(); pathPts(ctx, nightPoly(sun, hd), true); ctx.fill();
    }
  }

  const sel = positions.find((p) => p.id === selId);
  if (sel && d.mapTrack && selTrack.length > 1) {
    ctx.lineWidth = 1.6; ctx.strokeStyle = C.red; ctx.lineJoin = 'round';
    ctx.beginPath(); pathPts(ctx, selTrack, false); ctx.stroke();
  }
  if (sel && d.mapFootprint) {
    ctx.lineWidth = 1.4; ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent + '14';
    ctx.beginPath(); pathPts(ctx, footprint(sel.lat, sel.lon, sel.alt), true); ctx.fill(); ctx.stroke();
  }

  // station
  const st = S.state.station;
  for (const off of copies(st.lon, st.lon)) {
    const x = X(st.lon + off), y = Y(st.lat), r = 0.45 * rem();
    ctx.fillStyle = C.accent; ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y - r * 2.2, r * 1.15, Math.PI * 0.78, Math.PI * 2.22);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(x, y - r * 2.2, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }

  // satellites
  const fs = 0.78 * rem();
  ctx.font = `500 ${fs}px Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  const labels = d.mapLabels && (positions.length <= 60 || view.k > minK() * 2.5);
  for (const p of positions) {
    const isSel = p.id === selId;
    for (const off of copies(p.lon, p.lon)) {
      const x = X(p.lon + off), y = Y(p.lat);
      const r = (isSel ? 0.42 : 0.28) * rem();
      ctx.fillStyle = isSel ? C.accent : C.text;
      ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (labels || isSel) {
        ctx.lineWidth = 3; ctx.strokeStyle = C.bg + 'cc';
        ctx.strokeText(p.name, x + r + 4, y);
        ctx.fillStyle = isSel ? C.accent : C.text;
        ctx.fillText(p.name, x + r + 4, y);
      }
    }
  }
}

const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
function requestDraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(draw); } }

function resize() {
  const w = wrap.clientWidth, hh = wrap.clientHeight;
  if (!w || !hh) return;
  const first = !W;
  W = w; H = hh; dpr = window.devicePixelRatio || 1;
  for (const c of [canvas, baseCanvas]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  if (first || view.k < minK()) view.k = minK();
  if (first) { view.lat = 0; view.lon = S.state.station.lon || 0; }
  clampView();
  baseDirty = true;
  requestDraw();
}

// ----------------------------------------------------------------- live update
function update(now) {
  runAuto(now);
  const obs = observer(S.state.station);
  positions = [];
  for (const [id, rec] of recs) {
    const s = look(rec, id === selId ? obs : null, now);
    if (!s) continue;
    const e = S.byId.get(id);
    positions.push({ id, name: e ? e.name : String(id), ...s });
    if (id === selId) cur = s;
  }
  if (!recs.has(selId)) cur = null;
  if (selId && recs.has(selId) && now - trackAt > 60000) {
    const rec = recs.get(selId);
    const per = periodMin(rec) * 60000;
    selTrack = isDeepSpace(rec) ? [] : groundTrack(rec, now - per * 0.5, now + per * 1.5, per / 180);
    trackAt = now;
  }
  if (follow && cur) {
    view.lon = cur.lon;
    if (view.k > minK() * 1.3) view.lat = cur.lat;
    clampView();
    baseDirty = true;
  }
  // header + info panel
  const e = selId && S.byId.get(selId);
  const label = e ? `${e.id} - ${e.name}` : 'No satellite selected';
  if (auto) timer.update(autoPass || null, now, autoPass ? `AUTO · ${label}` : 'AUTO · waiting for the next pass');
  else timer.update(selId ? nextPass(now, selId) : null, now, label);
  const set = (k, v) => { info[k].textContent = v; };
  set('Azimuth', cur ? fmtDeg(cur.az) : '--');
  set('Elevation', cur ? fmtDeg(cur.el) : '--');
  info.Elevation.className = 'iv ' + (cur && cur.el >= 0 ? elClass(cur.el) : '');
  set('Altitude', cur ? fmtKm(cur.alt) : '--');
  set('Distance', cur ? fmtKm(cur.range) : '--');
  set('Latitude', cur ? fmtDeg(cur.lat, 2) : '--');
  set('Longitude', cur ? fmtDeg(cur.lon, 2) : '--');
  set('QTH', cur ? toQth(cur.lat, cur.lon) : '--');
  set('Velocity', cur ? cur.vel.toFixed(2) + ' km/s' : '--');
  requestDraw();
}

// ----------------------------------------------------------------- gestures
function setupGestures() {
  const pts = new Map();
  let start = null, lastTap = 0, pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pts.size === 1) {
      const t = performance.now();
      start = { x: e.offsetX, y: e.offsetY, t, moved: false, lon: view.lon, lat: view.lat };
      // second tap held down: drag up/down to zoom (one-finger zoom — works with a mouse
      // or a single-touch screen too)
      if (t - lastTap < 300) start.zoom = { k: view.k, lon: view.lon, lat: view.lat };
    }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      if (start) start.moved = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pts.size === 1 && start) {
      const dx = e.offsetX - start.x, dy = e.offsetY - start.y;
      if (Math.hypot(dx, dy) > 8) start.moved = true;
      if (start.moved && start.zoom) {
        Object.assign(view, start.zoom); // zoom relative to where the gesture started
        zoomAt(start.x, start.y, Math.exp(dy / 110));
      } else if (start.moved) {
        setFollow(false);
        view.lon = start.lon - dx / view.k;
        view.lat = start.lat + dy / view.k;
        clampView(); baseDirty = true; requestDraw();
      }
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pinch.d) / view.k);
    }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, t: 0, moved: true, lon: view.lon, lat: view.lat }; return; }
    if (start && !start.moved && performance.now() - start.t < 400) {
      const now = performance.now();
      if (start.zoom) { zoomAt(e.offsetX, e.offsetY, 2); lastTap = 0; }
      else { lastTap = now; hitTest(e.offsetX, e.offsetY); }
    }
    if (start && start.zoom) lastTap = 0;
    start = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
}

function zoomAt(x, y, f) {
  const lon = view.lon + (x - W / 2) / view.k, lat = view.lat - (y - H / 2) / view.k;
  view.k *= f;
  clampView();
  view.lon = lon - (x - W / 2) / view.k;
  view.lat = lat + (y - H / 2) / view.k;
  if (f > 1 && follow) { view.lon = cur ? cur.lon : view.lon; }
  clampView(); baseDirty = true; requestDraw();
}

function hitTest(x, y) {
  let best = null, bd = 1.6 * rem();
  for (const p of positions) {
    for (const off of copies(p.lon, p.lon)) {
      const d = Math.hypot(X(p.lon + off) - x, Y(p.lat) - y);
      if (d < bd) { bd = d; best = p; }
    }
  }
  if (best) select(best.id);
}

window.__l4sMapView = () => ({ ...view, follow, auto: typeof auto === "undefined" ? null : auto, selId });
function setFollow(v) {
  follow = v;
  followBtn.classList.toggle('primary', v);
  if (!v && auto) { auto = false; autoPass = null; autoBtn.classList.remove('primary'); }
}
function toggleFollow() {
  if (follow) { setFollow(false); toast('Free map: drag and zoom anywhere'); return; }
  setFollow(true);
  if (view.k < minK() * 1.5) view.k = minK() * 2; // zoom in a little so centring is visible
  const e = selId && S.byId.get(selId);
  toast(e ? `Following ${e.name} (drag the map to stop)` : 'Following the satellite');
  update(Date.now());
}
function centerHome() {
  setFollow(false);
  const st = S.state.station;
  view.k = Math.max(view.k, minK() * 2.5);
  view.lon = st.lon; view.lat = st.lat;
  clampView(); baseDirty = true; requestDraw();
  toast(S.state.station.set ? 'Centered on your station' : 'Set your station position in Settings first');
}

export default {
  id: 'map', label: 'Map', icon: 'map',
  mount(root) {
    timer = timerBox();
    canvas = h('canvas', { class: 'map-canvas' });
    ctx = canvas.getContext('2d');
    baseCanvas = document.createElement('canvas');
    followBtn = iconBtn('follow', toggleFollow, { label: 'Follow the satellite', class: 'primary' });
    homeBtn = iconBtn('home', centerHome, { label: 'Center on my station' });
    autoBtn = iconBtn('auto', () => setAuto(!auto), { label: 'Auto-track the next pass' });
    const cell = (k) => { info[k] = h('span', { class: 'iv' }, '--'); return h('div', { class: 'icell' }, h('span', { class: 'il' }, k), info[k]); };
    root.append(
      h('div', { class: 'topbar' }, iconBtn('left', () => cycle(-1), { label: 'Previous satellite' }), timer.el, iconBtn('right', () => cycle(1), { label: 'Next satellite' })),
      wrap = h('div', { class: 'card map-wrap' }, canvas,
        h('div', { class: 'map-tools' },
          iconBtn('plus', () => zoomAt(W / 2, H / 2, 1.6), { label: 'Zoom in' }),
          iconBtn('minus', () => zoomAt(W / 2, H / 2, 1 / 1.6), { label: 'Zoom out' }),
          followBtn, homeBtn, autoBtn),
        h('div', { class: 'map-info' }, ['Azimuth', 'Elevation', 'Altitude', 'Distance', 'Latitude', 'Longitude', 'QTH', 'Velocity'].map(cell))),
    );
    setupGestures();
    new ResizeObserver(() => resize()).observe(wrap);
    readColors();
    loadWorld();
    on('selection', () => { if (visible) rebuildRecs(); else recs = null; });
    on('catalog', () => { recs = null; });
    on('settings', (p) => {
      if (p?.display) { readColors(); baseDirty = true; if ('mapAll' in p.display) recs = null; }
      if (visible && !recs) rebuildRecs();
      if (visible) update(Date.now());
    });
  },
  show() {
    visible = true;
    if (S.mapSatId && S.mapSatId !== selId) { selId = S.mapSatId; follow = true; followBtn.classList.add('primary'); recs = null; }
    if (!recs || !recs.size) rebuildRecs();
    readColors();
    resize();
    update(Date.now());
  },
  hide() { visible = false; },
  tick(now) { if (visible) update(now); },
};
