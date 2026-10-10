# Builds web/assets/regions.json from Natural Earth GeoJSON: python3 tools/mkregions.py <natural-earth-vector/geojson dir> web/assets/regions.json
import json, sys, math
R = sys.argv[1]; out = sys.argv[2]
def dp(pts, eps):
    if len(pts) < 4: return pts
    keep = [False]*len(pts); keep[0] = keep[-1] = True
    st = [(0, len(pts)-1)]
    while st:
        a, b = st.pop()
        ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx-ax, by-ay; L = math.hypot(dx, dy)
        md, mi = -1, -1
        for i in range(a+1, b):
            px, py = pts[i]
            d = abs(dy*px - dx*py + bx*ay - by*ax)/L if L > 0 else math.hypot(px-ax, py-ay)
            if d > md: md, mi = d, i
        if md > eps: keep[mi] = True; st += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]
def rings(g):
    if not g: return []
    if g['type'] == 'Polygon': return g['coordinates']
    if g['type'] == 'MultiPolygon': return [r for p in g['coordinates'] for r in p]
    return []
def enc(feat, eps):
    rs = []
    for r in rings(feat['geometry']):
        s = dp(r, eps)
        if len(s) < 4: continue
        flat = []
        for x, y in s: flat += [round(x, 2), round(y, 2)]
        rs.append(flat)
    return rs
FIX = {"United States of America": "United States", "Dem. Rep. Congo": "DR Congo", "Central African Rep.": "Central African Republic",
       "Bosnia and Herz.": "Bosnia and Herzegovina", "Dominican Rep.": "Dominican Republic", "Eq. Guinea": "Equatorial Guinea",
       "S. Sudan": "South Sudan", "Solomon Is.": "Solomon Islands", "Falkland Is.": "Falkland Islands", "Fr. S. Antarctic Lands": "French Southern Lands",
       "W. Sahara": "Western Sahara", "Côte d'Ivoire": "Côte d'Ivoire", "N. Cyprus": "Northern Cyprus", "Marshall Is.": "Marshall Islands",
       "Cook Is.": "Cook Islands", "Faeroe Is.": "Faroe Islands", "Cayman Is.": "Cayman Islands", "Br. Indian Ocean Ter.": "British Indian Ocean Territory",
       "Heard I. and McDonald Is.": "Heard and McDonald Islands", "S. Geo. and the Is.": "South Georgia", "Turks and Caicos Is.": "Turks and Caicos Islands",
       "U.S. Virgin Is.": "US Virgin Islands", "British Virgin Is.": "British Virgin Islands", "N. Mariana Is.": "Northern Mariana Islands",
       "Fr. Polynesia": "French Polynesia", "Wallis and Futuna Is.": "Wallis and Futuna", "St. Pierre and Miquelon": "Saint Pierre and Miquelon",
       "Antigua and Barb.": "Antigua and Barbuda", "St. Vin. and Gren.": "Saint Vincent and the Grenadines", "St. Kitts and Nevis": "Saint Kitts and Nevis",
       "São Tomé and Principe": "São Tomé and Príncipe", "Siachen Glacier": "Siachen Glacier", "Ashmore and Cartier Is.": "Ashmore and Cartier Islands",
       "Indian Ocean Ter.": "Indian Ocean Territories", "Norfolk Island": "Norfolk Island", "Pitcairn Is.": "Pitcairn Islands", "eSwatini": "Eswatini"}
countries, admin1, marine = [], [], []
for f in json.load(open(R + '/ne_50m_admin_0_countries.geojson'))['features']:
    p = f['properties']; n = FIX.get(p['NAME'], p['NAME'])
    r = enc(f, 0.03)
    if r: countries.append({'n': n, 'r': r})
for f in json.load(open(R + '/ne_50m_admin_1_states_provinces.geojson'))['features']:
    p = f['properties']; r = enc(f, 0.03)
    if r: admin1.append({'n': p['name'], 'c': FIX.get(p['admin'], p['admin']), 't': p.get('type_en') or '', 'r': r})
for f in json.load(open(R + '/ne_50m_geography_marine_polys.geojson'))['features']:
    p = f['properties']
    # oceans: keep 'North Atlantic Ocean' etc. (name_en drops the North/South); others: English name
    n = p['name'] if p['featurecla'] == 'ocean' else (p.get('name_en') or p['name'])
    n = n.title() if n.isupper() else n
    n = n.replace('Bahía De Campeche', 'Bay of Campeche')
    r = enc(f, 0.05)
    if r: marine.append({'n': n, 'k': p['featurecla'], 'r': r})
json.dump({'source': 'Natural Earth 1:50m (public domain), simplified', 'countries': countries, 'admin1': admin1, 'marine': marine},
          open(out, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
print(len(countries), len(admin1), len(marine))
