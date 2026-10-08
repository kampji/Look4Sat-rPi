// Pass prediction runs here so the UI never stutters, even with hundreds of satellites.
import { makeSatrec, observer, elevation, look, periodMin } from './orbit.js';

const S = 1000;

function bisect(rec, obs, tLow, tHigh, rising) {
  // find horizon crossing to 1 s; rising: el(tLow)<0<=el(tHigh)
  while (tHigh - tLow > S) {
    const mid = (tLow + tHigh) / 2;
    const above = elevation(rec, obs, mid) >= 0;
    if (above === rising) tHigh = mid; else tLow = mid;
  }
  return rising ? tHigh : tLow;
}

function refineMax(rec, obs, a, b) {
  // golden-section search for max elevation in [a, b]
  const g = 0.618034;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = elevation(rec, obs, c), fd = elevation(rec, obs, d);
  while (b - a > S) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = elevation(rec, obs, c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = elevation(rec, obs, d); }
  }
  const t = (a + b) / 2;
  return { t, el: elevation(rec, obs, t) };
}

function passesFor(entry, obs, now, end, minEl, showDeep) {
  const rec = makeSatrec(entry);
  if (!rec) return [];
  const period = periodMin(rec);
  const base = { id: entry.id, name: entry.name };

  if (period >= 225) {
    if (!showDeep) return [];
    const l = look(rec, obs, now);
    if (!l || l.el < Math.max(0, minEl)) return [];
    return [{ ...base, deep: true, aos: 0, los: 0, tca: now, maxEl: l.el, aosAz: l.az, losAz: l.az, alt: l.alt }];
  }

  const out = [];
  let t = now - period * 60 * S; // look back one orbit to catch a pass in progress
  let el = elevation(rec, obs, t);
  if (Number.isNaN(el)) return [];
  // if we start inside a pass, skip to its end (it can't still be running "now")
  let guard = 0;
  while (el >= 0 && t < end && guard++ < 2000) { t += 20 * S; el = elevation(rec, obs, t); }

  guard = 0;
  while (t < end && guard++ < 100000) {
    const step = Math.min(300, Math.max(15, -el * 3)) * S;
    const t2 = t + step;
    const el2 = elevation(rec, obs, t2);
    if (Number.isNaN(el2)) break; // decayed / bad elements
    if (el < 0 && el2 >= 0) {
      const aos = bisect(rec, obs, t, t2, true);
      // walk through the pass
      let tt = aos, best = { t: aos, el: 0 }, e3 = 0, n = 0;
      while (e3 >= 0 && n++ < 5000) {
        tt += 10 * S;
        e3 = elevation(rec, obs, tt);
        if (Number.isNaN(e3)) break;
        if (e3 > best.el) best = { t: tt, el: e3 };
      }
      const los = bisect(rec, obs, tt - 10 * S, tt, false);
      const mx = refineMax(rec, obs, Math.max(aos, best.t - 10 * S), Math.min(los, best.t + 10 * S));
      if (mx.el >= minEl && los > now) {
        const a = look(rec, obs, aos), b = look(rec, obs, los), m = look(rec, obs, mx.t);
        out.push({ ...base, deep: false, aos, los, tca: mx.t, maxEl: mx.el, aosAz: a.az, losAz: b.az, alt: m.alt });
      }
      t = los + S;
      el = elevation(rec, obs, t);
      continue;
    }
    t = t2;
    el = el2;
  }
  return out;
}

self.onmessage = (ev) => {
  const { reqId, entries, station, hoursAhead, minEl, showDeep, now } = ev.data;
  const obs = observer(station);
  const end = now + hoursAhead * 3600 * S;
  const t0 = performance.now();
  let passes = [];
  for (const e of entries) {
    try {
      passes = passes.concat(passesFor(e, obs, now, end, minEl, showDeep));
    } catch (err) {
      // ignore broken element sets
    }
  }
  passes.sort((a, b) => (a.deep === b.deep ? a.aos - b.aos : a.deep ? -1 : 1));
  self.postMessage({ reqId, passes, ms: Math.round(performance.now() - t0) });
};
