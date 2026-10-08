import { S, on, emit, save, flush, api, reloadData, requestPasses } from '../store.js';
import { h, icon, onTap, toast, dialog, confirmDialog, toggle, stepper, segmented, input, fmtAgo, osk } from '../ui.js';
import { toQth, fromQth } from '../orbit.js';

let root, scroll, updatePoll = null;
const U = {};      // live elements of the data section (rebuilt on show)
let gpsStatusEl = null;

const section = (title, ic, ...body) => h('div', { class: 'card settings-sec' }, h('div', { class: 'sec-title' }, icon(ic), title), ...body);
const row = (label, control, hint) => h('div', { class: 'srow' }, h('div', { class: 'slabel' }, label, hint ? h('div', { class: 'hint' }, hint) : null), control);
const btn = (label, fn, cls = '') => { const b = h('button', { class: 'btn ' + cls }, label); onTap(b, fn); return b; };

// ----------------------------------------------------------------- station
function stationSection() {
  const st = { ...S.state.station };
  const lat = input(st.lat, { kind: 'num', cls: 'short' });
  const lon = input(st.lon, { kind: 'num', cls: 'short' });
  const alt = input(st.alt, { kind: 'num', cls: 'short' });
  const qth = input(toQth(st.lat, st.lon), { cls: 'short' });
  const status = h('div', { class: 'hint' }, S.state.station.set ? '' : 'Set your position so passes are correct.');

  const apply = (s, msg) => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180) { toast('Invalid coordinates'); return; }
    s.alt = Number.isFinite(s.alt) ? s.alt : 0;
    lat.value = s.lat; lon.value = s.lon; alt.value = s.alt; qth.value = toQth(s.lat, s.lon);
    save({ station: { lat: s.lat, lon: s.lon, alt: s.alt, set: true } }, 'settings');
    emit('settings', { station: true });
    requestPasses(true);
    status.textContent = '';
    toast(msg || 'Position saved');
  };
  const fromFields = () => apply({ lat: parseFloat(lat.value), lon: parseFloat(lon.value), alt: parseFloat(alt.value) });
  [lat, lon, alt].forEach((f) => f.addEventListener('keydown', (e) => { if (e.key === 'Enter') fromFields(); }));
  qth.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const p = fromQth(qth.value);
    if (!p) { toast('Locator should look like FN42 or FN42ab'); return; }
    apply({ ...p, alt: parseFloat(alt.value) || 0 }, 'Position set from QTH locator');
  });
  const gpsBtn = btn('From GPS', async () => {
    try {
      const g = await api('gps');
      if (!g.fix) { toast(S.state.gps.enabled ? `GPS: ${g.status}` : 'Enable gpsd under Radio & GPS first'); return; }
      apply({ lat: +g.fix.lat.toFixed(5), lon: +g.fix.lon.toFixed(5), alt: Math.round(g.fix.alt || 0) }, 'Position set from GPS');
    } catch (e) { toast(e.message); }
  });
  return section('Station position', 'gps',
    row('Latitude', lat, '° north (+) / south (−)'),
    row('Longitude', lon, '° east (+) / west (−)'),
    row('Altitude', alt, 'metres'),
    row('QTH locator', qth, 'Type a locator and press ⏎'),
    status,
    h('div', { class: 'btn-row' }, gpsBtn, btn('Save position', fromFields, 'primary')));
}

// ----------------------------------------------------------------- data
function dataSection() {
  const info = h('div', { class: 'hint' });
  const bar = h('div', { class: 'bar wide' }, h('div', { class: 'bar-fill' }));
  const msg = h('div', { class: 'hint' });
  const refreshInfo = () => {
    const m = S.meta;
    info.textContent = `${m.satellites || 0} satellites · ${m.radios || 0} transmitters · updated ${fmtAgo(m.updated)}`;
  };
  refreshInfo();
  U.refreshInfo = refreshInfo;
  const upd = btn('Update now', async () => {
    try { await api('update', { method: 'POST' }); } catch (e) { toast(e.message); return; }
    clearInterval(updatePoll); updatePoll = setInterval(pollUpdate, 800);
    pollUpdate();
  }, 'primary');
  Object.assign(U, { bar, msg, upd });
  if (updatePoll) { upd.disabled = true; bar.classList.add('busy'); }

  const fileIn = h('input', { type: 'file', accept: '.txt,.tle,.3le,.json,.csv', style: { display: 'none' } });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const r = await api('import', { method: 'POST', body: await f.text(), headers: { 'X-Filename': f.name } });
      toast(`Imported ${r.imported} satellites — run Update to merge them`);
    } catch (e) { toast('Import failed: ' + e.message); }
    fileIn.value = '';
  });

  const d = S.state.data;
  return section('Satellite data', 'refresh',
    info,
    h('div', { class: 'btn-row' }, btn('Sources…', sourcesDialog), btn('Import file…', () => fileIn.click()), upd),
    bar, msg, fileIn,
    row('Fetch categories', toggle(d.categories, (v) => save({ data: { categories: v } })), 'Satellite types from CelesTrak groups (slower update)'),
    row('Auto update', segmented([[0, 'Off'], [1, 'Daily'], [7, 'Weekly']], d.autoUpdateDays, (v) => save({ data: { autoUpdateDays: v } })), 'Checked when the app starts'),
    h('div', { class: 'hint' }, 'Tip: drop .txt/.tle files into the data/custom folder to include them on every update.'));
}

async function pollUpdate() {
  const u = await api('update').catch(() => null);
  if (!u || !U.bar) return;
  U.upd.disabled = !!u.running;
  U.bar.classList.toggle('busy', !!u.running);
  U.bar.firstChild.style.transform = `scaleX(${(u.progress || 0) / 100})`;
  U.msg.textContent = u.running ? `${Math.round(u.progress)}% · ${u.message}` : u.error ? '⚠ ' + u.error : u.message;
  if (!u.running) {
    clearInterval(updatePoll); updatePoll = null;
    if (u.finished && u.finished !== S.meta.updated) { await reloadData(); toast('Satellite data updated'); }
    U.refreshInfo?.();
  }
}

function sourcesDialog() {
  const d = JSON.parse(JSON.stringify(S.state.data));
  const listFor = (key, title) => {
    const box = h('div', { class: 'src-list' });
    const draw = () => {
      box.innerHTML = '';
      box.append(h('div', { class: 'muted src-head' }, title));
      d[key].forEach((s, i) => {
        const url = input(s.url, { oninput: (v) => (s.url = v.trim()) });
        const del = h('button', { class: 'btn-icon small flat', 'aria-label': 'Remove' }, icon('trash'));
        onTap(del, () => { d[key].splice(i, 1); draw(); });
        box.append(h('div', { class: 'src-row' }, toggle(s.enabled, (v) => (s.enabled = v)),
          h('div', { class: 'grow' }, h('div', { class: 'src-name' }, s.name || 'Custom'), url), del));
      });
      const add = btn('+ Add URL', () => { d[key].push({ name: 'Custom', url: '', enabled: true }); draw(); });
      box.append(add);
    };
    draw();
    return box;
  };
  dialog({
    title: 'Data sources', wide: true,
    body: h('div', {}, listFor('satSources', 'Satellite elements (TLE, 3LE, OMM JSON/CSV)'), listFor('radioSources', 'Transmitters (SatNOGS JSON)')),
    actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => {
      save({ data: { satSources: d.satSources.filter((s) => s.url), radioSources: d.radioSources.filter((s) => s.url) } });
      toast('Sources saved — run Update now to use them');
    } }],
  });
}

// ----------------------------------------------------------------- passes + display
function passesSection() {
  const p = S.state.passes;
  const recalc = () => requestPasses(true);
  return section('Passes', 'passes',
    row('Hours ahead', stepper(p.hoursAhead, { min: 1, max: 240, fmt: (v) => v + ' h', onchange: (v) => { save({ passes: { hoursAhead: v } }); debounce(recalc); } })),
    row('Min elevation', stepper(p.minElevation, { min: 0, max: 85, fmt: (v) => v + '°', onchange: (v) => { save({ passes: { minElevation: v } }); debounce(recalc); } })),
    row('Deep-space satellites', toggle(p.showDeepSpace, (v) => { save({ passes: { showDeepSpace: v } }); recalc(); }), 'Show visible GEO/HEO satellites'));
}
let dt;
const debounce = (fn) => { clearTimeout(dt); dt = setTimeout(fn, 700); };

function displaySection() {
  const d = S.state.display;
  const set = (k) => (v) => save({ display: { [k]: v } });
  return section('Display', 'layers',
    row('UTC time', toggle(d.utc, (v) => { save({ display: { utc: v } }); })),
    row('Night mode', toggle(d.night, set('night')), 'Red palette that preserves night vision'),
    row('UI scale', stepper(Math.round(d.scale * 100), { min: 60, max: 200, step: 10, fmt: (v) => v + '%', onchange: (v) => save({ display: { scale: v / 100 } }) })),
    row('Layout', segmented([['auto', 'Auto'], ['landscape', 'Landscape'], ['portrait', 'Portrait']], d.layout, set('layout'))),
    row('Rotate screen', segmented([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], Number(d.rotate) || 0, set('rotate')), 'For displays mounted sideways'),
    row('Radar sweep', toggle(d.sweep, set('sweep')), 'Turn off to save CPU'),
    row('On-screen keyboard', toggle(d.osk, (v) => { save({ display: { osk: v } }); if (!v) osk.hide(); })),
    row('Hide mouse cursor', toggle(d.hideCursor, set('hideCursor')), 'For touchscreens'),
    h('div', { class: 'sub-title' }, 'Map'),
    row('All selected satellites', toggle(d.mapAll, set('mapAll'))),
    row('Labels', toggle(d.mapLabels, set('mapLabels'))),
    row('Ground track', toggle(d.mapTrack, set('mapTrack'))),
    row('Footprint', toggle(d.mapFootprint, set('mapFootprint'))),
    row('Day / night', toggle(d.mapNight, set('mapNight'))));
}

// ----------------------------------------------------------------- radio / rotator / gps
function hamSection() {
  const block = (key, title, hint, extra = []) => {
    const c = S.state[key];
    const host = input(c.host, { cls: 'short', onchange: (v) => save({ [key]: { host: v.trim() } }) });
    const port = input(c.port, { kind: 'num', cls: 'tiny', onchange: (v) => save({ [key]: { port: parseInt(v, 10) || c.port } }) });
    return [
      row(title, toggle(c.enabled, (v) => save({ [key]: { enabled: v } })), hint),
      h('div', { class: 'srow indent' }, h('div', { class: 'slabel' }, 'Host : port'), h('span', { class: 'hostport' }, host, ':', port)),
      ...extra,
    ];
  };
  const gpsStatus = gpsStatusEl = h('span', { class: 'hint' }, '…');
  pollGps();
  return section('Radio, rotator & GPS', 'antenna',
    ...block('rotator', 'Rotator (rotctld)', 'Sends az/el while tracking from the Radar screen', [
      row('Min elevation to move', stepper(S.state.rotator.minEl || 0, { min: 0, max: 30, fmt: (v) => v + '°', onchange: (v) => save({ rotator: { minEl: v } }) }), null),
    ]),
    ...block('rig', 'Radio (rigctld)', 'Tunes the selected transmitter with doppler correction', [
      row('Frequency offset', stepper(S.state.rig.offsetHz || 0, { min: -50000, max: 50000, step: 100, fmt: (v) => (v > 0 ? '+' : '') + v + ' Hz', onchange: (v) => save({ rig: { offsetHz: v } }) })),
    ]),
    ...block('gps', 'GPS (gpsd)', 'Use a USB GPS for position and time', [
      row('Follow GPS position', toggle(S.state.gps.follow, (v) => save({ gps: { follow: v } })), 'Update the station whenever you move'),
      h('div', { class: 'srow indent' }, h('div', { class: 'slabel' }, 'Status'), gpsStatus),
    ]));
}

// ----------------------------------------------------------------- system
function systemSection() {
  const fs = btn('Full screen', () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); });
  return section('System', 'power',
    h('div', { class: 'btn-row wrap' },
      btn('Reload app', async () => { await flush(); location.reload(); }), fs,
      btn('Quit', () => confirmDialog('Quit Look4Sat rPi?', 'Closes the app and stops its server. Start it again from the Raspberry Pi menu (Look4Sat rPi) or with “look4sat start”.', 'Quit', async () => {
        await flush(); await api('quit', { method: 'POST' }).catch(() => {});
      }), 'primary'),
      btn('Reset settings', () => confirmDialog('Reset settings?', 'Restores defaults for everything except your station position.', 'Reset', async () => {
        await api('state/reset', { method: 'POST' }); location.reload();
      }))),
    h('div', { class: 'about' },
      h('div', {}, h('b', {}, 'Look4Sat rPi '), S.meta.version ? 'v' + S.meta.version : ''),
      h('div', { class: 'hint' }, 'An independent Raspberry Pi take on the Look4Sat Android app by Arty Bishop. SGP4 by satellite.js · map data Natural Earth · elements from CelesTrak, AMSAT and SatNOGS.')));
}

function build() {
  scroll.innerHTML = '';
  scroll.append(h('div', { class: 'settings-cols' }, stationSection(), dataSection(), passesSection(), displaySection(), hamSection(), systemSection()));
}

async function pollGps() {
  const g = await api('gps').catch(() => null);
  if (g && gpsStatusEl) gpsStatusEl.textContent = g.status + (g.fix ? ` · ${g.fix.lat.toFixed(4)}, ${g.fix.lon.toFixed(4)}` : '');
}
setInterval(() => { if (root?.classList.contains('active')) pollGps(); }, 5000);

// follow GPS: move the station when the fix drifts > ~200 m
setInterval(async () => {
  if (!S.state?.gps?.enabled || !S.state.gps.follow) return;
  const g = await api('gps').catch(() => null);
  if (!g?.fix) return;
  const st = S.state.station;
  if (Math.abs(g.fix.lat - st.lat) > 0.002 || Math.abs(g.fix.lon - st.lon) > 0.002 || !st.set) {
    save({ station: { lat: +g.fix.lat.toFixed(5), lon: +g.fix.lon.toFixed(5), alt: Math.round(g.fix.alt || 0), set: true } });
    emit('settings', { station: true });
    requestPasses(true);
  }
}, 30000);

export default {
  id: 'settings', label: 'Settings', icon: 'settings',
  mount(el) {
    root = el;
    el.append(scroll = h('div', { class: 'scroll settings' }));
    build();
    on('catalog', () => U.refreshInfo?.());
  },
  show() {
    // rebuild so values reflect changes made elsewhere (e.g. pass filter dialog)
    const y = scroll.scrollTop;
    build();
    scroll.scrollTop = y;
  },
};
