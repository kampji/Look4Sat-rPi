// ISS Live — the station's live video feed next to where it is right now (and what it is flying over).
// The video is loaded only while this page is visible (saves CPU / bandwidth on the Pi).
import { S, on, save } from '../store.js';
import { h, icon, iconBtn, onTap, dialog, input, toast, fmtTime, fmtDeg, fmtKm, elClass } from '../ui.js';
import { timerBox } from './common.js';
import { makeSatrec, look, toQth } from '../orbit.js';
import { nextPassOf, sunlit } from '../predict.js';
import { loadRegions, lookup } from '../regions.js';

const ISS = 25544;
const NASA_CHANNEL = 'UCLA_DiR1FfKNvjuUpBHmylQ';
// Video IDs of 24/7 streams change now and then; the channel option always picks NASA's current live video.
export const PRESETS = [
  { name: 'NASA — Live video from the ISS', url: 'https://www.youtube.com/watch?v=M3HKLzjvKPc' },
  { name: 'Sen — 4K Earth views from the ISS', url: 'https://www.youtube.com/watch?v=fO9e9jnhYK8' },
  { name: "NASA channel — whatever's live now", url: `https://www.youtube.com/channel/${NASA_CHANNEL}/live` },
];

let root, timer, frameWrap, srcBtnLabel, info = {}, note, overEl;
let track = { t: 0, segs: [] }; // what the ground track crosses, from 30 min ago to 30 min ahead
let visible = false, rec = null, recId = null, next = null, nextAt = 0, lightCache = { t: 0 };

const sources = () => [...PRESETS, ...((S.state.iss && S.state.iss.custom) || [])];
const current = () => { const list = sources(); return list[Math.min(S.state.iss?.source ?? 0, list.length - 1)] || list[0]; };

/** Turn any YouTube link (watch, youtu.be, /live/, /embed/, channel live) into an embeddable URL. */
export function embedUrl(url) {
  const q = 'autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1';
  let m = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (m) return `https://www.youtube.com/embed/live_stream?channel=${m[1]}&${q}`;
  m = url.match(/(?:v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([\w-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?${q}`;
  if (/^[\w-]{11}$/.test(url.trim())) return `https://www.youtube.com/embed/${url.trim()}?${q}`;
  return url; // any other page that allows framing
}

function loadVideo() {
  frameWrap.innerHTML = '';
  const src = current();
  srcBtnLabel.textContent = src.name;
  const f = h('iframe', {
    src: embedUrl(src.url), allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    referrerpolicy: 'strict-origin-when-cross-origin', frameborder: '0', title: src.name,
  });
  f.style.opacity = '0';
  f.addEventListener('load', () => { f.style.opacity = '1'; });
  frameWrap.append(h('div', { class: 'iss-loading' }, icon('video'), h('div', {}, 'Loading live video…'), h('div', { class: 'hint' }, 'Needs an internet connection')), f);
}
function unloadVideo() { frameWrap.innerHTML = ''; }

function sourceDialog() {
  dialog({
    title: 'Video source', wide: true,
    body: (c, close) => {
      const list = h('div', { class: 'src-pick' });
      const draw = () => {
        list.innerHTML = '';
        sources().forEach((s, i) => {
          const custom = i >= PRESETS.length;
          const row = h('div', { class: 'chk-item' + (i === (S.state.iss?.source ?? 0) ? ' on' : '') },
            h('span', { class: 'grow' }, h('div', {}, s.name), h('div', { class: 'hint ellipsis' }, s.url)),
            custom ? h('button', { class: 'btn-icon small flat del', 'aria-label': 'Remove' }, icon('trash')) : null,
            h('span', { class: 'cb' }, icon('check')));
          onTap(row, (e) => {
            if (e.target.closest('.del')) {
              const customs = [...S.state.iss.custom]; customs.splice(i - PRESETS.length, 1);
              save({ iss: { custom: customs, source: 0 } });
              draw(); return;
            }
            save({ iss: { source: i } });
            close(); if (visible) loadVideo();
          });
          list.append(row);
        });
      };
      draw();
      const name = input('', { placeholder: 'Name (optional)' });
      const url = input('', { placeholder: 'YouTube link or video ID' });
      const add = h('button', { class: 'btn' }, 'Add');
      onTap(add, () => {
        const u = url.value.trim();
        if (!u) { toast('Paste a YouTube link or video ID'); return; }
        const customs = [...(S.state.iss?.custom || []), { name: name.value.trim() || 'Custom stream', url: u }];
        save({ iss: { custom: customs, source: PRESETS.length + customs.length - 1 } });
        close(); if (visible) loadVideo();
      });
      c.append(list, h('div', { class: 'sub-title' }, 'Add a stream'), h('div', { class: 'add-src' }, name, url, add),
        h('p', { class: 'hint' }, 'If a preset shows "video unavailable", the stream was restarted under a new ID — the NASA channel option or a fresh link from youtube.com/@NASA/streams will work.'));
    },
  });
}

function ensureRec() {
  const e = S.byId.get(ISS);
  if (!e) { rec = null; return null; }
  if (recId !== e) { rec = makeSatrec(e); recId = e; next = null; }
  return e;
}

/** Sunlit now, and when it changes (searches ahead up to 2 h). Cached for 20 s. */
function light(now) {
  if (now - lightCache.t < 20000 && lightCache.rec === rec) return lightCache;
  const lit = sunlit(rec, now);
  let change = null;
  for (let t = now + 20000; t < now + 2 * 3600e3; t += 20000) if (sunlit(rec, t) !== lit) { change = t; break; }
  lightCache = { t: now, rec, lit, change };
  return lightCache;
}

/**
 * Sample the ground track from 30 min back to 30 min ahead and group it into segments of
 * "same place below". Cheap (240 lookups), refreshed every 30 s.
 */
function overflight(now) {
  if (now - track.t < 30000 && track.rec === rec) return track;
  const segs = [];
  const step = 15000;
  for (let t = now - 30 * 60000; t <= now + 30 * 60000; t += step) {
    const s = look(rec, null, t);
    const r = s && lookup(s.lat, s.lon);
    if (!r) continue;
    const last = segs[segs.length - 1];
    if (last && last.label === r.label) last.end = t;
    else segs.push({ label: r.label, kind: r.kind, start: t, end: t });
  }
  track = { t: now, rec, segs };
  return track;
}

function showOverflight(now) {
  const s = look(rec, null, now);
  const here = s && lookup(s.lat, s.lon);
  if (!here) { overEl.textContent = ''; return; }
  const { segs } = overflight(now);
  const i = segs.findIndex((g) => g.label === here.label && g.start <= now + 15000 && g.end >= now - 15000);
  // next place, skipping blips shorter than one sample (tiny islands, coastline wiggles)
  const after = segs.slice(i >= 0 ? i + 1 : 0).find((g) => g.start > now && g.end - g.start >= 15000 && g.label !== here.label);
  overEl.innerHTML = '';
  overEl.append(icon('globe', 'sm'), h('span', {}, 'Over '), h('span', { class: 'over-name ' + here.kind }, here.label));
  if (after) overEl.append(h('span', {}, ` · next ${after.label} in ${Math.max(1, Math.round((after.start - now) / 60000))} min`));
}

function update(now) {
  const e = ensureRec();
  if (!e || !rec) {
    timer.update(null, now, 'ISS (25544) not in the satellite data yet');
    for (const k in info) info[k].textContent = '--';
    return;
  }
  if (!next || next.los < now || now - nextAt > 10 * 60000) {
    next = nextPassOf(e, S.state.station, now, 48, S.state.passes.minElevation);
    nextAt = now;
  }
  timer.update(next, now, next ? `ISS over you at ${fmtTime(next.aos)} · max ${Math.round(next.maxEl)}°` : 'No ISS pass in the next 48 h');
  const s = look(rec, null, now);
  if (!s) return;
  info.Latitude.textContent = fmtDeg(s.lat, 2);
  info.Longitude.textContent = fmtDeg(s.lon, 2);
  info.Altitude.textContent = fmtKm(s.alt);
  info.Speed.textContent = Math.round(s.vel * 3600).toLocaleString() + ' km/h';
  info.QTH.textContent = toQth(s.lat, s.lon);
  const L = light(now);
  info.Light.textContent = L.lit ? 'Daylight' : 'Night';
  info.Light.className = 'iv ' + (L.lit ? 'el-mid' : 'muted');
  const mins = L.change ? Math.max(1, Math.round((L.change - now) / 60000)) : null;
  note.textContent = L.lit
    ? (mins ? `ISS in daylight · sunset on board in ${mins} min` : 'ISS in daylight')
    : (mins ? `ISS in Earth's shadow — the video looks dark for ~${mins} min` : "ISS in Earth's shadow — the video looks dark");
  showOverflight(now);
  if (next) info['Next pass'].className = 'iv ' + elClass(next.maxEl);
  info['Next pass'].textContent = next ? `${fmtTime(next.aos)} · ${Math.round(next.maxEl)}°` : '--';
}

export default {
  id: 'iss', label: 'ISS Live', icon: 'iss',
  mount(el) {
    root = el;
    timer = timerBox();
    srcBtnLabel = h('span', { class: 'src-name' });
    const srcBtn = h('button', { class: 'tile src-btn' }, icon('video'), srcBtnLabel, icon('down', 'sm'));
    onTap(srcBtn, sourceDialog);
    const cell = (k) => { info[k] = h('span', { class: 'iv' }, '--'); return h('div', { class: 'icell' }, h('span', { class: 'il' }, k), info[k]); };
    el.append(
      h('div', { class: 'topbar iss-bar' }, srcBtn, timer.el, iconBtn('refresh', () => loadVideo(), { label: 'Reload video' })),
      h('div', { class: 'iss-body' },
        frameWrap = h('div', { class: 'card iss-video' }),
        h('div', { class: 'card iss-info' },
          h('div', { class: 'iss-cells' }, ['Latitude', 'Longitude', 'Altitude', 'Speed', 'QTH', 'Light', 'Next pass'].map(cell)),
          h('div', { class: 'iss-foot' }, note = h('span', { class: 'iss-note' }), overEl = h('span', { class: 'iss-over' })))),
    );
    srcBtnLabel.textContent = current().name;
    on('catalog', () => { recId = null; next = null; });
    on('settings', (p) => { if (p?.station || p?.passes) next = null; });
    on('filter', () => { next = null; });
  },
  show() {
    visible = true; loadVideo(); update(Date.now());
    loadRegions().then(() => { track.t = 0; if (visible) update(Date.now()); }).catch(() => { overEl.textContent = ''; });
  },
  hide() { visible = false; unloadVideo(); },
  tick(now) { if (visible) update(now); },
};
