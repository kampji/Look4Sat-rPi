// Pass prediction + sun rise/set. Pure functions shared by the worker and the UI.
import * as sat from '../vendor/satellite.esm.js';
import { makeSatrec, observer, elevation, look, periodMin, jdOf, DEG } from './orbit.js';

const S = 1000;
const AU_KM = 149597870.7;

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

/** Minute of day (0..1439) in local time or UTC. */
export function minuteOfDay(ms, utc) {
  const d = new Date(ms);
  return utc ? d.getUTCHours() * 60 + d.getUTCMinutes() : d.getHours() * 60 + d.getMinutes();
}

/** Look4Sat's AOS time-window rule (window may wrap past midnight, optionally inverted). */
export function aosInWindow(aos, { aosStart = 0, aosEnd = 1439, invertAos = false, utc = false }) {
  if (aosStart === 0 && aosEnd >= 1439 && !invertAos) return true;
  const m = minuteOfDay(aos, utc);
  const inRange = aosStart <= aosEnd ? m >= aosStart && m <= aosEnd : !(m > aosEnd && m < aosStart);
  return invertAos ? !inRange : inRange;
}

/**
 * All passes of one satellite between now and `end` whose max elevation >= minEl.
 * AOS/LOS are horizon (0°) crossings, accurate to ~1 s.
 */
export function passesFor(entry, obs, now, end, minEl, showDeep, rec = makeSatrec(entry)) {
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

/** Next pass of a single satellite (any elevation >= minEl) within `hours`. */
export function nextPassOf(entry, station, now, hours = 24, minEl = 0) {
  const ps = passesFor(entry, observer(station), now, now + hours * 3600 * S, minEl, false);
  return ps.find((p) => p.los > now) || null;
}

// ------------------------------------------------------------------ sun
export function sunElevation(obs, ms) {
  const jd = jdOf(ms);
  const s = sat.sunPos(jd).rsun;
  const eci = { x: s.x * AU_KM, y: s.y * AU_KM, z: s.z * AU_KM };
  return sat.ecfToLookAngles(obs, sat.eciToEcf(eci, sat.gstime(jd))).elevation * DEG;
}

/** Sunrise / sunset (ms) within [dayStart, dayStart+24h), null when they don't happen (polar). */
export function sunRiseSet(station, dayStart) {
  const obs = observer(station);
  const H = -0.833; // refraction + solar radius
  const f = (t) => sunElevation(obs, t) - H;
  let rise = null, set = null;
  const step = 10 * 60 * S;
  let t0 = dayStart, f0 = f(t0);
  for (let t1 = dayStart + step; t1 <= dayStart + 24 * 3600 * S; t1 += step) {
    const f1 = f(t1);
    if ((f0 < 0) !== (f1 < 0)) {
      let a = t0, b = t1, fa = f0;
      while (b - a > 20 * S) { const m = (a + b) / 2, fm = f(m); if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m; }
      if (f0 < 0 && rise === null) rise = (a + b) / 2;
      else if (f0 >= 0 && set === null) set = (a + b) / 2;
    }
    t0 = t1; f0 = f1;
  }
  return { rise, set };
}

/** Is the satellite in sunlight? (cylindrical earth-shadow model, good enough for the ISS) */
export function sunlit(rec, ms) {
  const jd = jdOf(ms);
  const pv = sat.sgp4(rec, (jd - rec.jdsatepoch) * 1440);
  if (!pv || !pv.position) return null;
  const s = sat.sunPos(jd).rsun;
  const n = Math.hypot(s.x, s.y, s.z);
  const u = { x: s.x / n, y: s.y / n, z: s.z / n };
  const p = pv.position;
  const along = p.x * u.x + p.y * u.y + p.z * u.z;
  if (along > 0) return true;
  const perp = Math.hypot(p.x - along * u.x, p.y - along * u.y, p.z - along * u.z);
  return perp > 6378.137;
}
