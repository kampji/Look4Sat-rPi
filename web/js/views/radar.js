import { S, on, emit, api, nextPass } from '../store.js';
import { h, icon, iconBtn, onTap, toast, fmtDeg, fmtKm, fmtMHz, elClass } from '../ui.js';
import { timerBox, passCard } from './common.js';
import { makeSatrec, observer, look, C_KMS } from '../orbit.js';

let el, timer, canvas, ctx, base, cardWrap, txList, readout = {}, trackBtn;
let pass = null, userPicked = false, rec = null, obs = null, track = [], cur = null, card = null;
let visible = false, raf = 0, lastFrame = 0, sweepAngle = 0;
let tracking = false, lastRot = null, lastFreq = null, selectedTx = null, txRows = [];

export const theme = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { bg: v('--surface'), line: v('--radar-line'), text: v('--text'), muted: v('--muted'), accent: v('--accent'), red: v('--red'), green: v('--green') };
};
let T = null;

function setPass(p, picked) {
  pass = p;
  userPicked = !!picked;
  const entry = p && S.byId.get(p.id);
  rec = entry ? makeSatrec(entry) : null;
  obs = observer(S.state.station);
  track = [];
  if (rec && p && !p.deep) {
    const n = 120;
    for (let i = 0; i <= n; i++) {
      const s = look(rec, obs, p.aos + ((p.los - p.aos) * i) / n);
      if (s) track.push(s);
    }
  }
  cardWrap.innerHTML = '';
  card = null;
  if (p) {
    card = passCard(p);
    onTap(card.el, () => { S.mapSatId = p.id; emit('go', { id: 'map' }); });
    cardWrap.append(card.el);
  } else {
    cardWrap.append(h('div', { class: 'empty small' }, 'No pass selected'));
  }
  buildTx();
  lastRot = null; lastFreq = null;
  drawBase();
  frame(performance.now(), true);
}

function buildTx() {
  txList.innerHTML = '';
  txRows = [];
  const list = pass ? S.radios[pass.id] || [] : [];
  if (!list.length) {
    txList.append(h('div', { class: 'empty small' }, pass ? 'No transmitter data for this satellite' : ''));
    return;
  }
  list.forEach((t, i) => {
    const dl = h('span', { class: 'f' }), dh = h('span', { class: 'f' }), ul = h('span', { class: 'f' }), uh = h('span', { class: 'f' });
    const row = h('div', { class: 'card tx' + (selectedTx === i ? ' sel' : '') },
      h('div', { class: 'tx-title' }, `${t.d || 'Transmitter'} - (${t.m || '--'}/${t.um || '--'})${t.inv ? ' · inverted' : ''}${t.baud ? ` · ${t.baud} bd` : ''}`),
      h('div', { class: 'tx-line' }, h('span', { class: 'lbl' }, 'D:'), dl, h('span', { class: 'dash' }, '-'), dh, icon('down', 'sm muted')),
      t.ul || t.uh ? h('div', { class: 'tx-line' }, h('span', { class: 'lbl' }, 'U:'), ul, h('span', { class: 'dash' }, '-'), uh, icon('down', 'sm muted flip')) : null);
    onTap(row, () => {
      selectedTx = selectedTx === i ? null : i;
      txRows.forEach((r, j) => r.row.classList.toggle('sel', j === selectedTx));
      lastFreq = null;
      if (selectedTx !== null && !S.state.rig.enabled) toast('Selected. Enable rigctld in Settings to tune a radio.');
    });
    txRows.push({ row, t, dl, dh, ul, uh });
    txList.append(row);
  });
}

function updateTx() {
  if (!cur || !txRows.length) return;
  const f = cur.rangeRate / C_KMS; // + receding
  const d = (hz) => (hz ? fmtMHz(hz * (1 - f)) : '--.----');
  const u = (hz) => (hz ? fmtMHz(hz * (1 + f)) : '--.----');
  for (const r of txRows) {
    r.dl.textContent = d(r.t.dl); r.dh.textContent = d(r.t.dh);
    r.ul.textContent = u(r.t.ul); r.uh.textContent = u(r.t.uh);
  }
}

// ----------------------------------------------------------------- drawing
function geom() {
  const s = canvas.width;
  return { s, c: s / 2, r: s / 2 - Math.max(6, s * 0.035) };
}
const pt = (g, az, el) => {
  const rr = (g.r * (90 - Math.max(0, el))) / 90;
  const a = (az * Math.PI) / 180;
  return [g.c + rr * Math.sin(a), g.c - rr * Math.cos(a)];
};

function resize() {
  const wrap = canvas.parentElement;
  const size = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight));
  if (!size) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = canvas.style.height = size + 'px';
  canvas.width = canvas.height = Math.round(size * dpr);
  base.width = base.height = canvas.width;
  drawBase();
}

function drawBase() {
  if (!base.width) return;
  T = theme();
  const b = base.getContext('2d');
  const g = geom();
  const lw = Math.max(1, g.s / 260);
  b.clearRect(0, 0, g.s, g.s);
  b.strokeStyle = T.line; b.lineWidth = lw * 1.4;
  for (const k of [1, 2 / 3, 1 / 3]) { b.beginPath(); b.arc(g.c, g.c, g.r * k, 0, Math.PI * 2); b.stroke(); }
  b.beginPath();
  for (const a of [0, 45, 90, 135]) {
    const [x1, y1] = pt(g, a, 0), [x2, y2] = pt(g, a + 180, 0);
    if (a % 90 === 0) { b.moveTo(x1, y1); b.lineTo(x2, y2); }
  }
  b.stroke();
  b.save(); b.setLineDash([lw * 3, lw * 5]); b.lineWidth = lw * 0.8; b.beginPath();
  for (const a of [45, 135]) { const [x1, y1] = pt(g, a, 0), [x2, y2] = pt(g, a + 180, 0); b.moveTo(x1, y1); b.lineTo(x2, y2); }
  b.stroke(); b.restore();
  // labels
  const fs = Math.round(g.s * 0.045);
  b.font = `500 ${fs}px Roboto, sans-serif`; b.textAlign = 'center'; b.textBaseline = 'middle';
  b.fillStyle = T.accent;
  b.fillText('30°', g.c + fs * 1.1, g.c - (g.r * 2) / 3 + fs * 0.7);
  b.fillText('60°', g.c + fs * 1.1, g.c - g.r / 3 + fs * 0.7);
  b.fillText('90°', g.c + fs * 1.1, g.c + fs * 0.7);
  b.fillStyle = T.muted;
  const o = g.r - fs * 0.9;
  b.fillText('N', g.c, g.c - o); b.fillText('S', g.c, g.c + o); b.fillText('E', g.c + o, g.c); b.fillText('W', g.c - o, g.c);
  // pass trajectory
  if (track.length > 1) {
    b.lineWidth = lw * 2.4; b.strokeStyle = T.accent; b.lineCap = 'round'; b.lineJoin = 'round';
    b.beginPath();
    track.forEach((s, i) => { const [x, y] = pt(g, s.az, s.el); i ? b.lineTo(x, y) : b.moveTo(x, y); });
    b.stroke();
    const end = (s, col) => { const [x, y] = pt(g, s.az, s.el); b.fillStyle = col; b.beginPath(); b.arc(x, y, lw * 4, 0, Math.PI * 2); b.fill(); };
    end(track[0], T.green); end(track[track.length - 1], T.red);
  }
}

function frame(ts, force) {
  if (!ctx || !canvas.width) return;
  const sweepOn = S.state.display.sweep;
  if (!force && sweepOn && ts - lastFrame < 33) return; // ~30 fps is plenty on a Pi
  const dt = Math.min(100, ts - lastFrame);
  lastFrame = ts;
  const g = geom();
  ctx.clearRect(0, 0, g.s, g.s);
  ctx.fillStyle = T.bg;
  ctx.beginPath(); ctx.arc(g.c, g.c, g.r, 0, Math.PI * 2); ctx.fill();
  if (sweepOn && ctx.createConicGradient) {
    sweepAngle = (sweepAngle + dt * 0.0012) % (Math.PI * 2);
    const grad = ctx.createConicGradient(sweepAngle - Math.PI / 2, g.c, g.c);
    grad.addColorStop(0, T.accent + '00');
    grad.addColorStop(0.8, T.accent + '00');
    grad.addColorStop(0.995, T.accent + '55');
    grad.addColorStop(1, T.accent + '00');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(g.c, g.c, g.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.drawImage(base, 0, 0);
  if (cur && cur.el > -1) {
    const [x, y] = pt(g, cur.az, cur.el);
    const r = Math.max(4, g.s * 0.022);
    ctx.fillStyle = T.accent + '33'; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function loop(ts) {
  raf = 0;
  if (!visible) return;
  frame(ts);
  if (S.state.display.sweep) raf = requestAnimationFrame(loop);
}
const startLoop = () => { if (!raf && visible) raf = requestAnimationFrame(loop); };

// ----------------------------------------------------------------- rotator / rig
async function control() {
  if (!tracking || !cur || !pass) return;
  const rot = S.state.rotator, rig = S.state.rig;
  try {
    if (rot.enabled && cur.el >= (rot.minEl || 0)) {
      const az = Math.round(cur.az * 10) / 10, elv = Math.round(cur.el * 10) / 10;
      if (!lastRot || Math.abs(lastRot.az - az) >= 0.5 || Math.abs(lastRot.el - elv) >= 0.5) {
        lastRot = { az, el: elv };
        await api('rotator', { method: 'POST', body: { az, el: elv } });
      }
    }
    if (rig.enabled && selectedTx !== null) {
      const t = (S.radios[pass.id] || [])[selectedTx];
      if (t && t.dl) {
        const f = Math.round(t.dl * (1 - cur.rangeRate / C_KMS) + (rig.offsetHz || 0));
        if (lastFreq === null || Math.abs(f - lastFreq) >= 10) { lastFreq = f; await api('rig', { method: 'POST', body: { freq: f } }); }
      }
    }
    trackBtn.classList.remove('error');
  } catch (e) {
    trackBtn.classList.add('error');
    if (!control.warned) { toast('Radio/rotator: ' + e.message); control.warned = true; }
  }
}

function toggleTracking() {
  if (!S.state.rotator.enabled && !S.state.rig.enabled) { toast('Enable rotctld or rigctld in Settings → Radio & rotator'); return; }
  tracking = !tracking;
  control.warned = false;
  lastRot = null; lastFreq = null;
  trackBtn.classList.toggle('primary', tracking);
  toast(tracking ? 'Tracking on' : 'Tracking off');
  if (tracking) control();
}

export default {
  id: 'radar', label: 'Radar', icon: 'radar', parent: 'passes',
  mount(root) {
    el = root;
    timer = timerBox();
    trackBtn = iconBtn('rotator', toggleTracking, { label: 'Rotator / radio tracking' });
    canvas = h('canvas', { class: 'radar-canvas' });
    ctx = canvas.getContext('2d');
    base = document.createElement('canvas');
    const corner = (cls, label) => {
      const v = h('div', { class: 'rv' }, '--');
      readout[label] = v;
      return h('div', { class: 'corner ' + cls }, cls.includes('top') ? [v, h('div', { class: 'rl' }, label)] : [h('div', { class: 'rl' }, label), v]);
    };
    root.append(
      h('div', { class: 'topbar' }, iconBtn('back', () => emit('go', { id: 'passes' }), { label: 'Back' }), timer.el, trackBtn),
      h('div', { class: 'radar-body' },
        h('div', { class: 'card radar-card' },
          h('div', { class: 'radar-wrap' }, canvas),
          corner('top left', 'Azimuth'), corner('top right', 'Elevation'), corner('bottom left', 'Altitude'), corner('bottom right', 'Distance')),
        h('div', { class: 'radar-side' }, cardWrap = h('div', { class: 'radar-pass' }), txList = h('div', { class: 'scroll tx-list' }))),
    );
    new ResizeObserver(() => { if (visible) { resize(); frame(performance.now(), true); } }).observe(canvas.parentElement);
    on('settings', (p) => { if (p?.display) { drawBase(); startLoop(); } if (p?.station) setPass(pass, userPicked); });
    on('passes', () => {
      if (!visible || !pass) return;
      // keep showing the same pass if it is still in the list
      const same = S.passes.find((p) => p.id === pass.id && (p.deep ? pass.deep : Math.abs(p.aos - pass.aos) < 120000));
      if (!same && !userPicked) setPass(nextPass(Date.now()), false);
    });
  },
  show(arg) {
    visible = true;
    const now = Date.now();
    if (arg) setPass(arg, true);
    else if (!pass || (!pass.deep && pass.los < now - 60000)) setPass(S.radarPass || nextPass(now), !!S.radarPass);
    else setPass(pass, userPicked);
    resize();
    this.tick(now);
    startLoop();
  },
  hide() {
    visible = false;
    cancelAnimationFrame(raf); raf = 0;
  },
  tick(now) {
    if (pass && !pass.deep && pass.los < now - 30000 && !userPicked) setPass(nextPass(now), false);
    timer.update(pass, now);
    card?.update(now);
    cur = rec ? look(rec, obs, now) : null;
    readout.Azimuth.textContent = cur ? fmtDeg(cur.az) : '--';
    readout.Elevation.textContent = cur ? fmtDeg(cur.el) : '--';
    readout.Elevation.className = 'rv ' + (cur && cur.el >= 0 ? elClass(cur.el) : '');
    readout.Altitude.textContent = cur ? fmtKm(cur.alt) : '--';
    readout.Distance.textContent = cur ? fmtKm(cur.range) : '--';
    updateTx();
    if (!S.state.display.sweep) frame(performance.now(), true);
    control();
  },
};
