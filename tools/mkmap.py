# Builds web/assets/world.json from Natural Earth GeoJSON: python3 tools/mkmap.py <natural-earth-vector/geojson dir> web/assets/world.json
import json,sys
R=sys.argv[1]; out=sys.argv[2]
def dp(pts,eps):
    if len(pts)<3: return pts
    import math
    keep=[False]*len(pts); keep[0]=keep[-1]=True
    stack=[(0,len(pts)-1)]
    while stack:
        a,b=stack.pop()
        ax,ay=pts[a]; bx,by=pts[b]; dx,dy=bx-ax,by-ay; L=math.hypot(dx,dy)
        md=-1; mi=-1
        for i in range(a+1,b):
            px,py=pts[i]
            d=abs(dy*px-dx*py+bx*ay-by*ax)/L if L>0 else math.hypot(px-ax,py-ay)
            if d>md: md,mi=d,i
        if md>eps: keep[mi]=True; stack+= [(a,mi),(mi,b)]
    return [p for p,k in zip(pts,keep) if k]
def rings(geom):
    t=geom['type']; c=geom['coordinates']
    if t=='Polygon': return c
    if t=='MultiPolygon': return [r for p in c for r in p]
    if t=='LineString': return [c]
    if t=='MultiLineString': return c
    return []
def enc(fc,eps,minpts,filt=lambda f:True):
    res=[]
    for f in json.load(open(fc))['features']:
        if not f['geometry'] or not filt(f): continue
        for r in rings(f['geometry']):
            s=dp(r,eps)
            if len(s)<minpts: continue
            flat=[]
            for x,y in s: flat+= [round(x,2),round(y,2)]
            res.append(flat)
    return res
land=enc(R+'/ne_50m_land.geojson',0.04,4)
borders=enc(R+'/ne_50m_admin_0_boundary_lines_land.geojson',0.05,2)
lakes=enc(R+'/ne_50m_lakes.geojson',0.05,4,lambda f:(f['properties'].get('scalerank') or 9)<=2)
json.dump({'land':land,'borders':borders,'lakes':lakes},open(out,'w'),separators=(',',':'))
print(len(land),sum(len(r) for r in land)//2,len(borders),len(lakes))
