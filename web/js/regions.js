// Offline "what is below this point?" lookup: state/province (for the larger countries),
// country, or sea/ocean. Data: Natural Earth 1:50m (public domain), simplified.
// Loaded on demand (only the ISS Live page uses it).

let data = null, loading = null;

function prep(list) {
  return list.map((f) => {
    let mnx = 999, mny = 999, mxx = -999, mxy = -999;
    const rings = f.r.map((r) => {
      const a = new Float32Array(r);
      for (let i = 0; i < a.length; i += 2) {
        if (a[i] < mnx) mnx = a[i]; if (a[i] > mxx) mxx = a[i];
        if (a[i + 1] < mny) mny = a[i + 1]; if (a[i + 1] > mxy) mxy = a[i + 1];
      }
      return a;
    });
    return { ...f, r: rings, bb: [mnx, mny, mxx, mxy], area: (mxx - mnx) * (mxy - mny) };
  });
}

export function loadRegions(url = 'assets/regions.json') {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = fetch(url).then((r) => r.json()).then((raw) => {
      data = { countries: prep(raw.countries), admin1: prep(raw.admin1), marine: prep(raw.marine) };
      return data;
    });
  }
  return loading;
}

/** Even-odd point-in-polygon over all rings of a feature (handles holes and multipolygons). */
function inside(f, lon, lat) {
  const [a, b, c, d] = f.bb;
  if (lon < a || lon > c || lat < b || lat > d) return false;
  let hit = false;
  for (const r of f.r) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1], yj = r[j + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((r[j] - r[i]) * (lat - yi)) / (yj - yi) + r[i]) hit = !hit;
    }
  }
  return hit;
}

/** Fallback when no marine polygon matches (gaps between simplified polygons). */
function broadOcean(lat, lon) {
  if (lat > 66) return 'Arctic Ocean';
  if (lat < -60) return 'Southern Ocean';
  const ns = lat >= 0 ? 'North' : 'South';
  if (lon >= 20 && lon < 147 && lat < 30) return 'Indian Ocean';
  if (lon >= -70 && lon < 20) return `${ns} Atlantic Ocean`;
  return `${ns} Pacific Ocean`;
}

/**
 * Where is (lat, lon)? Returns { label, kind, country?, region? } or null before the data has loaded.
 * kind: 'land' | 'water'
 */
export function lookup(lat, lon) {
  if (!data) return null;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const country = data.countries.find((f) => inside(f, lon, lat));
  if (country) {
    const sub = data.admin1.find((f) => f.c === country.n && inside(f, lon, lat));
    return { kind: 'land', country: country.n, region: sub ? sub.n : null, label: sub ? `${sub.n}, ${country.n}` : country.n };
  }
  // most specific water body wins: a sea/gulf/strait before the ocean that surrounds it
  let best = null;
  for (const f of data.marine) {
    if (!inside(f, lon, lat)) continue;
    const rank = f.k === 'ocean' ? 1 : 0;
    if (!best || rank < best.rank || (rank === best.rank && f.area < best.f.area)) best = { f, rank };
  }
  const name = best ? best.f.n : broadOcean(lat, lon);
  return { kind: 'water', label: name };
}
