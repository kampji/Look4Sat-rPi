import sys
from playwright.sync_api import sync_playwright
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width":800,"height":480}, has_touch=True)
    pg = ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(1500)
    pg.click(".nav-item[data-id=map]"); pg.wait_for_timeout(800)
    cdp = ctx.new_cdp_session(pg)
    before = pg.evaluate("__l4sMapView()")
    cx, cy = 440, 250
    def tp(pts): return [{"x":x,"y":y,"id":i} for i,(x,y) in enumerate(pts)]
    cdp.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":tp([(cx-30,cy),(cx+30,cy)])})
    for d in range(30, 150, 10):
        cdp.send("Input.dispatchTouchEvent", {"type":"touchMove","touchPoints":tp([(cx-d,cy),(cx+d,cy)])})
        pg.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]})
    pg.wait_for_timeout(300)
    after = pg.evaluate("__l4sMapView()")
    print("pinch k:", round(before["k"],2), "->", round(after["k"],2))
    # one-finger drag pan
    cdp.send("Input.dispatchTouchEvent", {"type":"touchStart","touchPoints":tp([(400,250)])})
    for d in range(0,120,10):
        cdp.send("Input.dispatchTouchEvent", {"type":"touchMove","touchPoints":tp([(400+d,250)])}); pg.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type":"touchEnd","touchPoints":[]}); pg.wait_for_timeout(200)
    a2 = pg.evaluate("__l4sMapView()")
    print("pan lon:", round(after["lon"],1), "->", round(a2["lon"],1), "follow", a2["follow"])
    print(errs or "no errors")
    b.close()
