#!/usr/bin/env python3
"""
Offline test harness: runs server.py with the network replaced by synthetic data
(element sets with today's epoch in TLE, OMM JSON and SatNOGS formats, CelesTrak
category groups and SatNOGS transmitters). Used for screenshots / CI without internet.

    python3 tests/fake_net.py --port 8650 --data /tmp/l4s-test
"""
import datetime as dt
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402

NOW = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def gmst_deg(t):
    jd = t.timestamp() / 86400 + 2440587.5
    T = (jd - 2451545.0) / 36525
    g = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T
    return g % 360


def checksum(line):
    return sum(int(c) if c.isdigit() else (1 if c == "-" else 0) for c in line[:68]) % 10


def tle(name, norad, incl, raan, ecc, argp, ma, n, bstar="10000-3", ndot=0.00001):
    yy = NOW.year % 100
    doy = NOW.timetuple().tm_yday + (NOW.hour * 3600 + NOW.minute * 60 + NOW.second) / 86400
    nd = f"{ndot:.8f}".replace("0.", " .", 1)
    l1 = f"1 {norad:05d}U 20001A   {yy:02d}{doy:012.8f} {nd}  00000-0  {bstar} 0  999"
    l2 = f"2 {norad:05d} {incl:8.4f} {raan % 360:8.4f} {int(round(ecc * 1e7)):07d} {argp:8.4f} {ma % 360:8.4f} {n:11.8f}{1000:5d}"
    l1 += str(checksum(l1)); l2 += str(checksum(l2))
    assert len(l1) == 69 and len(l2) == 69, (l1, l2)
    return (name, l1, l2), {
        "OBJECT_NAME": name, "OBJECT_ID": "2020-001A", "EPOCH": NOW.strftime("%Y-%m-%dT%H:%M:%S.000000"),
        "MEAN_MOTION": n, "ECCENTRICITY": ecc, "INCLINATION": incl, "RA_OF_ASC_NODE": raan % 360,
        "ARG_OF_PERICENTER": argp, "MEAN_ANOMALY": ma % 360, "EPHEMERIS_TYPE": 0, "CLASSIFICATION_TYPE": "U",
        "NORAD_CAT_ID": norad, "ELEMENT_SET_NO": 999, "REV_AT_EPOCH": 1000, "BSTAR": 0.0001,
        "MEAN_MOTION_DOT": ndot, "MEAN_MOTION_DDOT": 0}


def geo(name, norad, lon):
    # place a geostationary satellite over `lon`
    return tle(name, norad, 0.02, lon + gmst_deg(NOW), 0.0002, 0, 0, 1.00271, bstar="00000-0", ndot=0)


SATS = [
    tle("ISS (ZARYA)", 25544, 51.64, 210, 0.0005, 80, 30, 15.50),
    tle("CSS (TIANHE)", 48274, 41.47, 100, 0.0004, 30, 200, 15.60),
    tle("SAUDISAT 1C (SO-50)", 27607, 64.56, 300, 0.0040, 120, 100, 14.80),
    tle("JAS-2 (FO-29)", 24278, 98.55, 20, 0.0350, 250, 170, 13.53),
    tle("RS-44", 44909, 82.52, 140, 0.0220, 330, 60, 12.80),
    tle("NOAA 15", 25338, 98.55, 330, 0.0010, 90, 10, 14.26),
    tle("NOAA 18", 28654, 98.90, 50, 0.0013, 120, 300, 14.13),
    tle("NOAA 19", 33591, 99.10, 180, 0.0014, 150, 250, 14.13),
    tle("METEOR-M2 3", 57166, 98.70, 270, 0.0002, 90, 140, 14.24),
    tle("METEOR-M2 4", 59051, 98.70, 300, 0.0002, 90, 20, 14.24),
    tle("HST", 20580, 28.47, 60, 0.0002, 40, 80, 15.09),
    geo("ES'HAIL 2", 43700, 25.9),
    geo("GOES 16", 41866, -75.2),
    tle("GPS BIIF-2 (PRN 01)", 37753, 55.0, 30, 0.009, 50, 10, 2.0056, bstar="00000-0", ndot=0),
    tle("MOLNIYA 1-91", 25485, 63.4, 200, 0.70, 270, 0, 2.006, bstar="00000-0", ndot=0),
]
random.seed(7)
FILLER = [tle(f"CUBESAT-{i:04d}", 60000 + i, random.uniform(40, 99), random.uniform(0, 360), random.uniform(0, 0.01),
              random.uniform(0, 360), random.uniform(0, 360), random.uniform(14.2, 15.4)) for i in range(2500)]

ALL = SATS + FILLER
TLE_TEXT = "\n".join("\n".join(t) for t, _ in ALL)
OMM_JSON = json.dumps([o for _, o in ALL[:8] + FILLER])          # "CelesTrak active"
AMSAT = "\n".join("\n".join(t) for t, _ in SATS[2:6])            # 3LE text
SATNOGS = json.dumps([{"tle0": t[0], "tle1": t[1], "tle2": t[2], "norad_cat_id": int(t[1][2:7])} for t, _ in SATS[8:]])
GROUPS = {
    "amateur": SATS[0:5] + FILLER[:40], "weather": SATS[5:10] + SATS[12:13], "noaa": SATS[5:8],
    "stations": SATS[0:2], "visual": SATS[0:2] + SATS[10:11], "geo": SATS[11:13], "gps-ops": SATS[13:14],
    "gnss": SATS[13:14], "cubesat": FILLER[:300], "science": SATS[10:11],
}
TX = [
    {"description": "FM voice repeater", "alive": True, "uplink_low": 145990000, "downlink_low": 436795000, "mode": "FM", "uplink_mode": "FM", "norad_cat_id": 27607},
    {"description": "APRS digipeater", "alive": True, "uplink_low": 145825000, "downlink_low": 145825000, "mode": "AFSK", "uplink_mode": "AFSK", "baud": 1200, "norad_cat_id": 25544},
    {"description": "FM voice", "alive": True, "downlink_low": 437800000, "mode": "FM", "uplink_low": 145990000, "uplink_mode": "FM", "norad_cat_id": 25544},
    {"description": "SSTV", "alive": True, "downlink_low": 145800000, "mode": "FM", "norad_cat_id": 25544},
    {"description": "Linear transponder", "alive": True, "uplink_low": 145935000, "uplink_high": 145995000, "downlink_low": 435795000, "downlink_high": 435855000, "mode": "USB", "uplink_mode": "LSB", "invert": True, "norad_cat_id": 44909},
    {"description": "CW beacon", "alive": True, "downlink_low": 435610000, "mode": "CW", "norad_cat_id": 44909},
    {"description": "APT", "alive": True, "downlink_low": 137620000, "mode": "APT", "norad_cat_id": 25338},
    {"description": "APT", "alive": True, "downlink_low": 137912500, "mode": "APT", "norad_cat_id": 28654},
    {"description": "APT", "alive": True, "downlink_low": 137100000, "mode": "APT", "norad_cat_id": 33591},
    {"description": "LRPT", "alive": True, "downlink_low": 137900000, "mode": "LRPT", "norad_cat_id": 57166},
    {"description": "NB transponder", "alive": True, "uplink_low": 2400050000, "uplink_high": 2400300000, "downlink_low": 10489550000, "downlink_high": 10489800000, "mode": "SSB", "uplink_mode": "SSB", "norad_cat_id": 43700},
    {"description": "BPSK400 Upper Beacon", "alive": True, "downlink_low": 10489800000, "mode": "BPSK", "uplink_mode": "", "norad_cat_id": 43700},
]


def fake_get(url, timeout=60):
    if "GROUP=active" in url:
        return OMM_JSON
    if "amsat" in url:
        return AMSAT
    if "satnogs.org/api/tle" in url:
        return SATNOGS
    if "transmitters" in url:
        return json.dumps(TX)
    if "GROUP=" in url:
        g = url.split("GROUP=")[1].split("&")[0]
        if g in GROUPS:
            return "\n".join("\n".join(t) for t, _ in GROUPS[g])
        raise OSError("HTTP Error 404: group not in fake data")
    raise OSError("offline test: " + url)


if __name__ == "__main__":
    server.http_get = fake_get
    server.POLITE_DELAY = 0
    server.main()
