#!/usr/bin/env python3
"""
Look4Sat rPi - local backend.

A small, dependency-free (Python 3 stdlib only) HTTP server that:
  * serves the touch UI in ./web
  * stores settings + satellite selection in ./data/state.json
  * downloads and merges satellite elements (TLE / OMM) and SatNOGS transmitters
  * optionally reads your position from gpsd
  * optionally forwards az/el to rotctld and doppler-corrected frequency to rigctld

All orbital maths runs in the browser (satellite.js), so this process stays tiny.

Usage:  python3 server.py [--host 127.0.0.1] [--port 8642] [--data DIR]
"""

import argparse
import calendar
import csv
import io
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "Look4Sat rPi"
VERSION = "1.0.0"
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
POLITE_DELAY = 0.4  # seconds between CelesTrak group requests
USER_AGENT = f"Look4Sat-rPi/{VERSION} (+https://github.com/rt-bishop/Look4Sat inspired)"

# --------------------------------------------------------------------------------------
# Defaults
# --------------------------------------------------------------------------------------

CELESTRAK = "https://celestrak.org/NORAD/elements/gp.php"

DEFAULT_SAT_SOURCES = [
    {"name": "CelesTrak - active", "url": f"{CELESTRAK}?GROUP=active&FORMAT=json", "enabled": True},
    {"name": "AMSAT - nasabare", "url": "https://www.amsat.org/tle/current/nasabare.txt", "enabled": True},
    {"name": "SatNOGS DB", "url": "https://db.satnogs.org/api/tle/?format=json", "enabled": True},
]
DEFAULT_RADIO_SOURCES = [
    {"name": "SatNOGS transmitters",
     "url": "https://db.satnogs.org/api/transmitters/?format=json&status=active", "enabled": True},
]

# (label, CelesTrak GROUP). Used only to tag satellites with a "type" for filtering.
CATEGORY_GROUPS = [
    ("Amateur", "amateur"), ("Weather", "weather"), ("NOAA", "noaa"), ("GOES", "goes"),
    ("Space stations", "stations"), ("Brightest", "visual"), ("Last 30 days", "last-30-days"),
    ("CubeSats", "cubesat"), ("SatNOGS", "satnogs"), ("Earth resources", "resource"),
    ("Search & rescue", "sarsat"), ("Disaster monitoring", "dmc"), ("Science", "science"),
    ("Education", "education"), ("Engineering", "engineering"), ("Geodetic", "geodetic"),
    ("Military", "military"), ("Radar calibration", "radar"), ("Geostationary", "geo"),
    ("GNSS", "gnss"), ("GPS", "gps-ops"), ("GLONASS", "glo-ops"), ("Galileo", "galileo"),
    ("Beidou", "beidou"), ("SBAS", "sbas"), ("Iridium NEXT", "iridium-NEXT"),
    ("Starlink", "starlink"), ("OneWeb", "oneweb"), ("Orbcomm", "orbcomm"),
    ("Globalstar", "globalstar"), ("Planet", "planet"), ("Spire", "spire"),
    ("Intelsat", "intelsat"), ("SES", "ses"), ("TDRSS", "tdrss"), ("Argos", "argos"),
    ("Experimental comm", "x-comm"), ("Other comm", "other-comm"), ("Other", "other"),
]

DEFAULT_SELECTION = [
    25544,  # ISS (ZARYA)
    48274,  # CSS (TIANHE)
    27607,  # SAUDISAT 1C (SO-50)
    24278,  # FO-29
    44909,  # RS-44
    25338,  # NOAA 15
    28654,  # NOAA 18
    33591,  # NOAA 19
    57166,  # METEOR-M2 3
    59051,  # METEOR-M2 4
    20580,  # HST
]

DEFAULT_STATE = {
    "version": 1,
    "station": {"lat": 0.0, "lon": 0.0, "alt": 0.0, "set": False},
    "passes": {"hoursAhead": 24, "minElevation": 10, "showDeepSpace": True},
    "display": {
        "utc": False, "scale": 1.0, "rotate": 0, "layout": "auto", "sweep": True,
        "osk": True, "night": False, "mapLabels": True, "mapTrack": True,
        "mapFootprint": True, "mapNight": True, "mapAll": True, "hideCursor": False,
    },
    "data": {
        "satSources": DEFAULT_SAT_SOURCES,
        "radioSources": DEFAULT_RADIO_SOURCES,
        "categories": True,
        "autoUpdateDays": 7,
    },
    "gps": {"enabled": False, "follow": False, "host": "127.0.0.1", "port": 2947},
    "rotator": {"enabled": False, "host": "127.0.0.1", "port": 4533, "minEl": 0},
    "rig": {"enabled": False, "host": "127.0.0.1", "port": 4532, "offsetHz": 0},
    "selection": DEFAULT_SELECTION,
}

# --------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def deep_merge(base, override):
    """Return base updated recursively with override (lists/scalars replace)."""
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def atomic_write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)


def http_get(url, timeout=60):
    if not url.startswith("http"):
        url = "https://" + url
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


# --------------------------------------------------------------------------------------
# Element-set parsing (TLE / 3LE / OMM JSON / OMM CSV / SatNOGS JSON)
# --------------------------------------------------------------------------------------

ALPHA5 = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # no I or O


def alpha5_to_int(field):
    field = field.strip()
    if not field:
        return None
    if field[0].isalpha():
        try:
            return (ALPHA5.index(field[0].upper()) + 10) * 10000 + int(field[1:])
        except ValueError:
            return None
    try:
        return int(field)
    except ValueError:
        return None


def tle_epoch_ts(line1):
    """Unix timestamp (s) of a TLE's epoch."""
    try:
        yy = int(line1[18:20])
        doy = float(line1[20:32])
        year = 2000 + yy if yy < 57 else 1900 + yy
        jan1 = calendar.timegm((year, 1, 1, 0, 0, 0, 0, 0, 0))
        return jan1 + (doy - 1) * 86400
    except ValueError:
        return 0


def omm_epoch_ts(epoch):
    try:
        s = epoch.rstrip("Z")
        main, _, frac = s.partition(".")
        t = time.strptime(main, "%Y-%m-%dT%H:%M:%S")
        return calendar.timegm(t) + (float("0." + frac) if frac else 0)
    except (ValueError, AttributeError):
        return 0


OMM_KEYS = ["OBJECT_NAME", "OBJECT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION",
            "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "NORAD_CAT_ID", "BSTAR",
            "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"]


def clean_name(name, norad):
    name = (name or "").strip()
    if name.startswith("0 "):
        name = name[2:].strip()
    return name or f"NORAD {norad}"


def entry_from_tle(name, l1, l2):
    norad = alpha5_to_int(l1[2:7])
    if norad is None:
        return None
    return {"id": norad, "name": clean_name(name, norad), "tle": [l1.rstrip(), l2.rstrip()],
            "epoch": tle_epoch_ts(l1)}


def entry_from_omm(d):
    try:
        norad = int(d["NORAD_CAT_ID"])
        omm = {}
        for k in OMM_KEYS:
            v = d.get(k)
            if k in ("OBJECT_NAME", "OBJECT_ID", "EPOCH"):
                omm[k] = str(v or "")
            else:
                omm[k] = float(v) if v not in (None, "") else 0.0
        omm["NORAD_CAT_ID"] = norad
        return {"id": norad, "name": clean_name(d.get("OBJECT_NAME"), norad), "omm": omm,
                "epoch": omm_epoch_ts(omm["EPOCH"])}
    except (KeyError, ValueError, TypeError):
        return None


def parse_elements(text):
    """Parse any supported element format into a list of entries."""
    text = text.lstrip("﻿").strip()
    out = []
    if not text:
        return out
    if text[0] in "[{":
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("results") or data.get("data") or [data]
        for d in data:
            if not isinstance(d, dict):
                continue
            if "MEAN_MOTION" in d:
                e = entry_from_omm(d)
            elif "tle1" in d:  # SatNOGS
                e = entry_from_tle(d.get("tle0", ""), d["tle1"], d["tle2"])
            elif "TLE_LINE1" in d:  # Space-Track style
                e = entry_from_tle(d.get("TLE_LINE0", d.get("OBJECT_NAME", "")), d["TLE_LINE1"], d["TLE_LINE2"])
            else:
                e = None
            if e:
                out.append(e)
        return out
    first = text.splitlines()[0]
    if "OBJECT_NAME" in first and "," in first:  # OMM CSV
        for row in csv.DictReader(io.StringIO(text)):
            e = entry_from_omm(row)
            if e:
                out.append(e)
        return out
    # Plain TLE / 3LE
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    i, prev_name = 0, ""
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("1 ") and i + 1 < len(lines) and lines[i + 1].startswith("2 "):
            e = entry_from_tle(prev_name, ln, lines[i + 1])
            if e:
                out.append(e)
            prev_name = ""
            i += 2
            continue
        prev_name = ln
        i += 1
    return out


def ids_from_text(text):
    """Return the set of catalog numbers in a TLE text (used for category groups)."""
    ids = set()
    for ln in text.splitlines():
        if ln.startswith("1 ") and len(ln) > 7:
            n = alpha5_to_int(ln[2:7])
            if n is not None:
                ids.add(n)
    return ids


def parse_transmitters(text):
    """SatNOGS transmitters -> {norad: [compact transmitter, ...]}"""
    out = {}
    for t in json.loads(text):
        if not isinstance(t, dict):
            continue
        norad = t.get("norad_cat_id")
        if not norad or t.get("alive") is False:
            continue
        item = {
            "d": t.get("description") or "",
            "dl": t.get("downlink_low"), "dh": t.get("downlink_high"),
            "ul": t.get("uplink_low"), "uh": t.get("uplink_high"),
            "m": t.get("mode") or "", "um": t.get("uplink_mode") or "",
            "inv": bool(t.get("invert")), "baud": t.get("baud"),
        }
        if not (item["dl"] or item["ul"]):
            continue
        out.setdefault(str(norad), []).append(item)
    return out


# --------------------------------------------------------------------------------------
# App state + data store
# --------------------------------------------------------------------------------------


class Store:
    def __init__(self, data_dir):
        self.dir = data_dir
        os.makedirs(self.dir, exist_ok=True)
        os.makedirs(os.path.join(self.dir, "custom"), exist_ok=True)
        self.state_path = os.path.join(self.dir, "state.json")
        self.catalog_path = os.path.join(self.dir, "catalog.json")
        self.radios_path = os.path.join(self.dir, "radios.json")
        self.lock = threading.RLock()
        self.state = self._load_state()
        self.update = {"running": False, "progress": 0, "message": "", "error": None,
                       "finished": self.meta().get("updated", 0)}

    def _load_state(self):
        try:
            with open(self.state_path, encoding="utf-8") as f:
                return deep_merge(DEFAULT_STATE, json.load(f))
        except (OSError, ValueError):
            return json.loads(json.dumps(DEFAULT_STATE))

    def save_state(self, patch):
        with self.lock:
            self.state = deep_merge(self.state, patch)
            atomic_write_json(self.state_path, self.state)
            return self.state

    def reset_state(self):
        with self.lock:
            keep_station = self.state.get("station")
            self.state = json.loads(json.dumps(DEFAULT_STATE))
            self.state["station"] = keep_station
            atomic_write_json(self.state_path, self.state)
            return self.state

    def meta(self):
        try:
            with open(os.path.join(self.dir, "meta.json"), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    # ---------------------------------------------------------------- update
    def start_update(self):
        with self.lock:
            if self.update["running"]:
                return False
            self.update = {"running": True, "progress": 0, "message": "Starting", "error": None,
                           "finished": self.update.get("finished", 0)}
        threading.Thread(target=self._run_update, daemon=True).start()
        return True

    def _status(self, progress, message):
        self.update["progress"] = progress
        self.update["message"] = message
        log("update:", f"{progress:3.0f}%", message)

    def _run_update(self):
        try:
            cfg = self.state["data"]
            sat_sources = [s for s in cfg.get("satSources", []) if s.get("enabled")]
            radio_sources = [s for s in cfg.get("radioSources", []) if s.get("enabled")]
            groups = CATEGORY_GROUPS if cfg.get("categories") else []
            custom_files = sorted(
                os.path.join(self.dir, "custom", f) for f in os.listdir(os.path.join(self.dir, "custom"))
                if f.lower().endswith((".txt", ".tle", ".3le", ".json", ".csv")))
            total = max(1, len(sat_sources) + len(radio_sources) + len(groups) + len(custom_files))
            done = 0
            sats, errors = {}, []

            names = {}  # first real name wins (source order = priority); newest elements win

            def merge(entries, origin):
                for e in entries:
                    if e["id"] not in names and not e["name"].startswith("NORAD "):
                        names[e["id"]] = e["name"]
                    old = sats.get(e["id"])
                    if old is None or e["epoch"] >= old["epoch"]:
                        e["src"] = origin
                        sats[e["id"]] = e
                    sats[e["id"]]["name"] = names.get(e["id"], e["name"])

            for s in sat_sources:
                self._status(100 * done / total, f"Downloading {s.get('name') or s['url']}")
                try:
                    entries = parse_elements(http_get(s["url"]))
                    merge(entries, s.get("name") or s["url"])
                    log(f"  {len(entries)} entries")
                except Exception as ex:  # noqa: BLE001 - report and carry on
                    errors.append(f"{s.get('name') or s['url']}: {ex}")
                done += 1

            for path in custom_files:
                self._status(100 * done / total, f"Importing {os.path.basename(path)}")
                try:
                    with open(path, encoding="utf-8", errors="replace") as f:
                        merge(parse_elements(f.read()), "custom:" + os.path.basename(path))
                except Exception as ex:  # noqa: BLE001
                    errors.append(f"{os.path.basename(path)}: {ex}")
                done += 1

            if not sats:
                # keep whatever we had before rather than wiping the catalog
                raise RuntimeError("No satellites downloaded. " + "; ".join(errors))

            cats = {}
            for label, group in groups:
                self._status(100 * done / total, f"Categories: {label}")
                try:
                    for n in ids_from_text(http_get(f"{CELESTRAK}?GROUP={group}&FORMAT=tle", timeout=45)):
                        cats.setdefault(n, []).append(label)
                except Exception as ex:  # noqa: BLE001
                    errors.append(f"Category {label}: {ex}")
                done += 1
                time.sleep(POLITE_DELAY)  # be polite to CelesTrak

            radios = {}
            for s in radio_sources:
                self._status(100 * done / total, f"Downloading {s.get('name') or s['url']}")
                try:
                    for k, v in parse_transmitters(http_get(s["url"], timeout=90)).items():
                        radios.setdefault(k, []).extend(v)
                except Exception as ex:  # noqa: BLE001
                    errors.append(f"{s.get('name') or s['url']}: {ex}")
                done += 1
            if not radios and os.path.exists(self.radios_path):
                with open(self.radios_path, encoding="utf-8") as f:
                    radios = json.load(f)  # keep old transmitter data if download failed

            self._status(98, "Saving")
            catalog = []
            for e in sorted(sats.values(), key=lambda x: x["name"].upper()):
                item = {"id": e["id"], "name": e["name"], "src": e["src"]}
                if "tle" in e:
                    item["tle"] = e["tle"]
                else:
                    item["omm"] = e["omm"]
                c = cats.get(e["id"])
                if c:
                    item["cat"] = c
                catalog.append(item)
            atomic_write_json(self.catalog_path, catalog)
            atomic_write_json(self.radios_path, radios)
            meta = {"updated": int(time.time()), "satellites": len(catalog),
                    "radios": sum(len(v) for v in radios.values()),
                    "categories": [lbl for lbl, _ in groups] if cats else self.meta().get("categories", []),
                    "errors": errors}
            atomic_write_json(os.path.join(self.dir, "meta.json"), meta)
            self.update.update({"running": False, "progress": 100, "finished": meta["updated"],
                                "message": f"{len(catalog)} satellites, {meta['radios']} transmitters",
                                "error": ("; ".join(errors[:4]) if errors else None)})
            log("update finished", self.update["message"])
        except Exception as ex:  # noqa: BLE001
            log("update failed:", ex)
            self.update.update({"running": False, "error": str(ex), "message": "Update failed"})


# --------------------------------------------------------------------------------------
# gpsd client + hamlib (rotctld / rigctld) TCP forwarding
# --------------------------------------------------------------------------------------


class Gpsd:
    def __init__(self, store):
        self.store = store
        self.fix = None
        self.status = "off"
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            cfg = self.store.state.get("gps", {})
            if not cfg.get("enabled"):
                self.status = "off"
                time.sleep(2)
                continue
            try:
                self.status = "connecting"
                with socket.create_connection((cfg.get("host", "127.0.0.1"), int(cfg.get("port", 2947))), 5) as s:
                    s.sendall(b'?WATCH={"enable":true,"json":true}\n')
                    s.settimeout(10)
                    buf = b""
                    self.status = "waiting for fix"
                    while self.store.state.get("gps", {}).get("enabled"):
                        chunk = s.recv(4096)
                        if not chunk:
                            break
                        buf += chunk
                        while b"\n" in buf:
                            line, buf = buf.split(b"\n", 1)
                            self._handle(line)
            except (OSError, ValueError) as ex:
                self.status = f"error: {ex}"
                time.sleep(5)

    def _handle(self, line):
        try:
            msg = json.loads(line)
        except ValueError:
            return
        if msg.get("class") == "TPV" and msg.get("mode", 0) >= 2 and "lat" in msg:
            self.fix = {"lat": msg["lat"], "lon": msg["lon"],
                        "alt": msg.get("altMSL", msg.get("alt", 0)) or 0,
                        "mode": msg["mode"], "time": msg.get("time"), "ts": time.time()}
            self.status = f"{msg['mode']}D fix"


class Hamlib:
    """Keeps one TCP connection per hamlib daemon and sends simple commands."""

    def __init__(self):
        self.socks = {}
        self.lock = threading.Lock()

    def send(self, host, port, cmd):
        key = (host, int(port))
        with self.lock:
            for attempt in range(2):
                s = self.socks.get(key)
                try:
                    if s is None:
                        s = socket.create_connection(key, timeout=2)
                        s.settimeout(2)
                        self.socks[key] = s
                    s.sendall((cmd + "\n").encode())
                    reply = s.recv(256).decode(errors="replace").strip()
                    return reply
                except OSError as ex:
                    try:
                        if s:
                            s.close()
                    finally:
                        self.socks.pop(key, None)
                    if attempt == 1:
                        raise ex
        return ""


# --------------------------------------------------------------------------------------
# HTTP layer
# --------------------------------------------------------------------------------------


class Handler(SimpleHTTPRequestHandler):
    store: Store = None
    gpsd: Gpsd = None
    hamlib: Hamlib = None
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, fmt, *args):  # quieter logs
        if args and isinstance(args[0], str) and args[0].startswith(("GET /api/update", "GET /api/gps")):
            return
        if "--verbose" in sys.argv:
            super().log_message(fmt, *args)

    def end_headers(self):
        if self.path.startswith(("/js/", "/css/", "/index.html")) or self.path == "/":
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ------------------------------------------------------------- utils
    def _json(self, obj, status=200):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, fallback=b"[]"):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            body = fallback
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        return raw

    def _body_json(self):
        raw = self._body()
        return json.loads(raw or b"{}")

    # ------------------------------------------------------------- routes
    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p == "/api/state":
            return self._json(self.store.state)
        if p == "/api/catalog":
            return self._file(self.store.catalog_path)
        if p == "/api/radios":
            return self._file(self.store.radios_path, b"{}")
        if p == "/api/meta":
            return self._json({**self.store.meta(), "app": APP_NAME, "version": VERSION,
                               "groups": [g for g, _ in CATEGORY_GROUPS]})
        if p == "/api/update":
            return self._json(self.store.update)
        if p == "/api/gps":
            return self._json({"status": self.gpsd.status, "fix": self.gpsd.fix})
        if p == "/api/time":
            return self._json({"now": time.time()})
        return super().do_GET()

    def do_PUT(self):
        p = self.path.split("?", 1)[0]
        try:
            if p == "/api/state":
                return self._json(self.store.save_state(self._body_json()))
        except ValueError as ex:
            return self._json({"error": str(ex)}, 400)
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        p = self.path.split("?", 1)[0]
        try:
            if p == "/api/state":  # navigator.sendBeacon on page unload
                return self._json(self.store.save_state(self._body_json()))
            if p == "/api/update":
                started = self.store.start_update()
                return self._json({"started": started, **self.store.update})
            if p == "/api/state/reset":
                return self._json(self.store.reset_state())
            if p == "/api/import":
                text = self._body().decode("utf-8", errors="replace")
                entries = parse_elements(text)
                if not entries:
                    return self._json({"error": "No valid TLE/OMM data found"}, 400)
                name = re.sub(r"[^A-Za-z0-9_.-]", "_", self.headers.get("X-Filename") or "import.txt")
                with open(os.path.join(self.store.dir, "custom", name), "w", encoding="utf-8") as f:
                    f.write(text)
                return self._json({"imported": len(entries), "file": name})
            if p in ("/api/quit", "/api/kiosk/exit"):
                # Quit the app: close the window opened by scripts/look4sat.sh (it uses its own
                # browser profile) and stop this server, so nothing keeps running.
                self._json({"ok": True})
                subprocess.run(["pkill", "-f", "look4sat-rpi-chromium"], check=False)
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return None
            if p == "/api/rotator":
                b = self._body_json()
                cfg = self.store.state["rotator"]
                if b.get("park"):
                    reply = self.hamlib.send(cfg["host"], cfg["port"], "P 0 0")
                else:
                    reply = self.hamlib.send(cfg["host"], cfg["port"], f"P {float(b['az']):.1f} {float(b['el']):.1f}")
                return self._json({"ok": True, "reply": reply})
            if p == "/api/rig":
                b = self._body_json()
                cfg = self.store.state["rig"]
                reply = self.hamlib.send(cfg["host"], cfg["port"], f"F {int(b['freq'])}")
                return self._json({"ok": True, "reply": reply})
        except (OSError, ValueError, KeyError) as ex:
            return self._json({"error": str(ex)}, 502)
        self._json({"error": "not found"}, 404)


def main():
    ap = argparse.ArgumentParser(description=APP_NAME + " server")
    ap.add_argument("--host", default=os.environ.get("L4S_HOST", "127.0.0.1"),
                    help="bind address (use 0.0.0.0 to reach it from other devices)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("L4S_PORT", "8642")))
    ap.add_argument("--data", default=os.environ.get("L4S_DATA", os.path.join(ROOT, "data")))
    ap.add_argument("--no-auto-update", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    store = Store(args.data)
    Handler.store = store
    Handler.gpsd = Gpsd(store)
    Handler.hamlib = Hamlib()

    if not args.no_auto_update:
        days = store.state["data"].get("autoUpdateDays") or 0
        last = store.meta().get("updated", 0)
        if not os.path.exists(store.catalog_path) or (days and time.time() - last > days * 86400):
            log("catalog missing or stale - starting background update")
            store.start_update()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    log(f"{APP_NAME} {VERSION} on http://{args.host}:{args.port}  (data: {args.data})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
