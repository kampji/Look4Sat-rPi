// App state: settings (persisted by the server), catalog, transmitters and predicted passes.

export const S = {
  state: null,        // settings + selection (server: data/state.json)
  meta: {},           // catalog info (update time, counts, category names)
  catalog: [],        // [{id, name, tle|omm, cat?, src}]
  byId: new Map(),
  radios: {},         // {norad: [transmitter]}
  passes: [],         // predicted passes for selected satellites
  passesAt: 0,        // when passes were computed
  passesBusy: false,
  radarPass: null,    // pass shown in Radar (null = auto: next/active)
  mapSatId: null,     // satellite focused on the Map
};

// ------------------------------------------------------------------ events
const handlers = {};
export const on = (evt, fn) => (handlers[evt] ||= []).push(fn);
export const emit = (evt, data) => (handlers[evt] || []).forEach((fn) => fn(data));

// ------------------------------------------------------------------ API
export async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined && typeof opts.body !== 'string' ? { 'Content-Type': 'application/json' } : opts.headers,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  }
  return out;
}

let saveTimer = null, pending = {};
/** Update settings locally right away; persist to the server shortly after. */
export function save(patch, evt = 'settings') {
  S.state = merge(S.state, patch);
  pending = merge(pending, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
  emit(evt, patch);
}
export async function flush() {
  clearTimeout(saveTimer);
  const p = pending; pending = {};
  if (!Object.keys(p).length) return;
  try { await api('state', { method: 'PUT', body: p }); } catch (e) { console.warn('save failed', e); }
}
window.addEventListener('beforeunload', () => { if (Object.keys(pending).length) navigator.sendBeacon?.('/api/state', JSON.stringify(pending)); });

export async function loadAll() {
  const [state, meta, catalog, radios] = await Promise.all([
    api('state'), api('meta'), api('catalog').catch(() => []), api('radios').catch(() => ({})),
  ]);
  S.state = state;
  S.meta = meta;
  setCatalog(catalog);
  S.radios = radios || {};
}

export async function reloadData() {
  const [meta, catalog, radios] = await Promise.all([api('meta'), api('catalog'), api('radios')]);
  S.meta = meta;
  setCatalog(catalog);
  S.radios = radios || {};
  emit('catalog');
  requestPasses(true);
}

function setCatalog(list) {
  S.catalog = Array.isArray(list) ? list : [];
  S.byId = new Map(S.catalog.map((e) => [e.id, e]));
}

export const selectedSet = () => new Set(S.state.selection || []);
export const selectedEntries = () => (S.state.selection || []).map((id) => S.byId.get(id)).filter(Boolean);

// ------------------------------------------------------------------ passes (web worker)
const worker = new Worker(new URL('./passes.worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
worker.onmessage = (ev) => {
  if (ev.data.reqId !== reqId) return; // stale
  S.passes = ev.data.passes;
  S.passesAt = Date.now();
  S.passesBusy = false;
  console.info(`passes: ${S.passes.length} in ${ev.data.ms} ms`);
  emit('passes');
};

export function requestPasses(force = false) {
  if (!S.state) return;
  if (!force && S.passesBusy) return;
  const st = S.state;
  S.passesBusy = true;
  emit('passes-busy');
  const p = st.passes;
  let entries = selectedEntries();
  // "modes" filter (Look4Sat's radios dialog): only satellites with a transmitter in one of the modes
  const modes = new Set(p.modes || []);
  if (modes.size) entries = entries.filter((e) => (S.radios[e.id] || []).some((r) => modes.has(r.m) || modes.has(r.um)));
  worker.postMessage({
    reqId: ++reqId,
    entries,
    station: st.station,
    hoursAhead: p.hoursAhead,
    minEl: p.minElevation,
    showDeep: p.showDeepSpace,
    window: { aosStart: p.aosStart ?? 0, aosEnd: p.aosEnd ?? 1439, invertAos: !!p.invertAos, utc: !!st.display.utc },
    now: Date.now(),
  });
}

/** Called every second: drop finished passes, recompute when the window runs low. */
export function tickPasses(now) {
  const before = S.passes.length;
  S.passes = S.passes.filter((p) => p.deep || p.los > now);
  const stale = now - S.passesAt > 30 * 60 * 1000; // deep-space visibility + horizon drift
  if (!S.passesBusy && S.passesAt && (stale || (before && S.passes.length < before && S.passes.filter((p) => !p.deep).length < 3))) {
    requestPasses();
  }
  return S.passes.length !== before;
}

/** The pass to feature: an active one first, else the next to rise. */
export function nextPass(now, id = null) {
  let best = null;
  for (const p of S.passes) {
    if (p.deep || (id !== null && p.id !== id)) continue;
    if (p.los <= now) continue;
    if (!best || p.aos < best.aos) best = p;
  }
  return best;
}
