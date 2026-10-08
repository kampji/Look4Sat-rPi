// Orbital helpers on top of satellite.js (SGP4/SDP4). Shared by the UI and the pass worker.
import * as sat from '../vendor/satellite.esm.js';

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;
export const RE = 6378.137;          // km, WGS-84 equatorial radius
export const MU = 398600.4418;       // km^3/s^2
export const C_KMS = 299792.458;     // speed of light, km/s
const OMEGA_E = 7.292115e-5;         // earth rotation, rad/s

export function makeSatrec(entry) {
  try {
    const rec = entry.tle ? sat.twoline2satrec(entry.tle[0], entry.tle[1]) : sat.json2satrec(entry.omm);
    if (!rec || rec.error) return null;
    return rec;
  } catch {
    return null;
  }
}

export const jdOf = (ms) => ms / 86400000 + 2440587.5;
export const msOfJd = (jd) => (jd - 2440587.5) * 86400000;

/** Orbital period in minutes. */
export const periodMin = (rec) => (2 * Math.PI) / rec.no;
export const isDeepSpace = (rec) => periodMin(rec) >= 225;

export function observer(station) {
  return { latitude: station.lat * RAD, longitude: station.lon * RAD, height: (station.alt || 0) / 1000 };
}

function eci(rec, ms) {
  const jd = jdOf(ms);
  const pv = sat.sgp4(rec, (jd - rec.jdsatepoch) * 1440);
  if (!pv || !pv.position || typeof pv.position !== 'object' || Number.isNaN(pv.position.x)) return null;
  return { p: pv.position, v: pv.velocity, gmst: sat.gstime(jd) };
}

/** Elevation only (fast path for pass search). Returns degrees or NaN. */
export function elevation(rec, obs, ms) {
  const e = eci(rec, ms);
  if (!e) return NaN;
  return sat.ecfToLookAngles(obs, sat.eciToEcf(e.p, e.gmst)).elevation * DEG;
}

/**
 * Full state of a satellite as seen from `obs` (may be null for ground-only data).
 * az/el deg, range km, rangeRate km/s (+ = receding), lat/lon deg, alt km, vel km/s
 */
export function look(rec, obs, ms) {
  const e = eci(rec, ms);
  if (!e) return null;
  const geo = sat.eciToGeodetic(e.p, e.gmst);
  const out = {
    lat: geo.latitude * DEG,
    lon: normLon(geo.longitude * DEG),
    alt: geo.height,
    vel: Math.hypot(e.v.x, e.v.y, e.v.z),
  };
  if (obs) {
    const la = sat.ecfToLookAngles(obs, sat.eciToEcf(e.p, e.gmst));
    out.az = (la.azimuth * DEG + 360) % 360;
    out.el = la.elevation * DEG;
    out.range = la.rangeSat;
    // range rate from relative ECI position/velocity
    const o = sat.ecfToEci(sat.geodeticToEcf(obs), e.gmst);
    const ov = { x: -OMEGA_E * o.y, y: OMEGA_E * o.x, z: 0 };
    const dx = e.p.x - o.x, dy = e.p.y - o.y, dz = e.p.z - o.z;
    const r = Math.hypot(dx, dy, dz);
    out.rangeRate = (dx * (e.v.x - ov.x) + dy * (e.v.y - ov.y) + dz * (e.v.z - ov.z)) / r;
  }
  return out;
}

export const normLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Ground track as [[lat, lon], ...] with *unwrapped* longitudes (continuous across the date line). */
export function groundTrack(rec, fromMs, toMs, stepMs = 60000) {
  const pts = [];
  let prev = null;
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const s = look(rec, null, t);
    if (!s) continue;
    let lon = s.lon;
    if (prev !== null) {
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
    }
    prev = lon;
    pts.push([s.lat, lon]);
  }
  return pts;
}

/** Footprint (visibility circle) as polygon [[lat, lon], ...] with unwrapped longitudes. */
export function footprint(lat, lon, altKm, n = 90) {
  const lam = Math.acos(RE / (RE + altKm));
  const p = lat * RAD;
  const pts = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const b = (i / n) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(p) * Math.cos(lam) + Math.cos(p) * Math.sin(lam) * Math.cos(b));
    let lon2 = lon + DEG * Math.atan2(Math.sin(b) * Math.sin(lam) * Math.cos(p), Math.cos(lam) - Math.sin(p) * Math.sin(lat2));
    if (prev !== null) {
      while (lon2 - prev > 180) lon2 -= 360;
      while (lon2 - prev < -180) lon2 += 360;
    }
    prev = lon2;
    pts.push([lat2 * DEG, lon2]);
  }
  // A footprint that contains a pole doesn't close in longitude: close it over the pole.
  const span = pts[pts.length - 1][1] - pts[0][1];
  if (Math.abs(span) > 180) {
    const pole = lat > 0 ? 90 : -90;
    const last = pts[pts.length - 1][1];
    pts.push([pole, last], [pole, pts[0][1]]);
  }
  return pts;
}

/** Sub-solar point (deg). */
export function subSolar(ms) {
  const jd = jdOf(ms);
  const s = sat.sunPos(jd);
  const gmst = sat.gstime(jd);
  return { lat: s.decl * DEG, lon: normLon((s.rtasc - gmst) * DEG) };
}

/** Orbital elements summary for the details dialog. */
export function elements(rec) {
  const nRadS = rec.no / 60;
  const a = Math.cbrt(MU / (nRadS * nRadS));
  return {
    period: periodMin(rec),
    incl: rec.inclo * DEG,
    ecc: rec.ecco,
    raan: rec.nodeo * DEG,
    apogee: a * (1 + rec.ecco) - RE,
    perigee: a * (1 - rec.ecco) - RE,
    epoch: msOfJd(rec.jdsatepoch + (rec.jdsatepochF || 0)),
  };
}

// ----------------------------------------------------------------- Maidenhead QTH locator
export function toQth(lat, lon) {
  let lo = lon + 180, la = lat + 90;
  const A = 'ABCDEFGHIJKLMNOPQR', a = 'abcdefghijklmnopqrstuvwx';
  lo = Math.min(Math.max(lo, 0), 359.9999); la = Math.min(Math.max(la, 0), 179.9999);
  const f1 = Math.floor(lo / 20), f2 = Math.floor(la / 10);
  const s1 = Math.floor((lo % 20) / 2), s2 = Math.floor(la % 10);
  const x1 = Math.floor(((lo % 2) * 60) / 5), x2 = Math.floor(((la % 1) * 60) / 2.5);
  return A[f1] + A[f2] + s1 + s2 + a[x1] + a[x2];
}

export function fromQth(qth) {
  const q = (qth || '').trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(q)) return null;
  let lon = (q.charCodeAt(0) - 65) * 20 - 180 + Number(q[2]) * 2;
  let lat = (q.charCodeAt(1) - 65) * 10 - 90 + Number(q[3]);
  if (q.length === 6) {
    lon += ((q.charCodeAt(4) - 65) * 5) / 60 + 2.5 / 60;
    lat += ((q.charCodeAt(5) - 65) * 2.5) / 60 + 1.25 / 60;
  } else {
    lon += 1; lat += 0.5;
  }
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}
