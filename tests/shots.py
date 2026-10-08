#!/usr/bin/env python3
"""Screenshot every screen at a given size. python3 tests/shots.py URL OUTDIR [WxH ...]"""
import sys
from playwright.sync_api import sync_playwright

url, out = sys.argv[1], sys.argv[2]
sizes = sys.argv[3:] or ["800x480"]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--disable-gpu"])
    for size in sizes:
        w, hgt = map(int, size.split("x"))
        pg = b.new_page(viewport={"width": w, "height": hgt}, has_touch=True)
        pg.on("console", lambda m: m.type in ("error", "warning") and errors.append(f"{size} console {m.type}: {m.text}"))
        pg.on("pageerror", lambda e: errors.append(f"{size} pageerror: {e}"))
        pg.goto(url)
        pg.wait_for_timeout(2500)
        for view in ["passes", "satellites", "iss", "map", "settings"]:
            pg.click(f".nav-item[data-id={view}]")
            pg.wait_for_timeout(1500)
            pg.screenshot(path=f"{out}/{size}-{view}.png")
        pg.close()
    b.close()
print("\n".join(errors) or "no console errors")
