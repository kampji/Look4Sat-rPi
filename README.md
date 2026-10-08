# Look4Sat rPi

A touch-friendly satellite tracker and pass predictor for Raspberry Pi OS. It is an independent port of the Android app [Look4Sat](https://github.com/rt-bishop/Look4Sat) by Arty Bishop, with the same dark look and five screens: **Satellites, Passes, Radar, Map and Settings**.

It is built for an 800×480 touchscreen in landscape. The layout also adapts to portrait and to any other resolution.

## How it works

```
 ┌──────────────── Chromium (kiosk, full screen) ────────────────┐
 │  web/  — HTML/CSS/JS UI, no framework                          │
 │    satellite.js (SGP4/SDP4) for positions                      │
 │    passes.worker.js — pass prediction in a background thread   │
 └──────────────▲─────────────────────────────────────────────────┘
                │ http://127.0.0.1:8642
 ┌──────────────┴──── server.py (Python 3 stdlib only) ───────────┐
 │  settings + selection  → data/state.json                       │
 │  CelesTrak / AMSAT / SatNOGS download → data/catalog.json      │
 │  SatNOGS transmitters → data/radios.json                       │
 │  gpsd (position)  ·  rotctld (az/el)  ·  rigctld (frequency)   │
 └────────────────────────────────────────────────────────────────┘
```

* **No pip or npm installs.** It needs only Python 3 and Chromium, which ship with Raspberry Pi OS desktop. The satellite.js library, the Roboto font and a Natural Earth world map are bundled in `web/`.
* **Works offline.** After one data update, all calculations run on the Pi.

## Install on the Pi

You need Raspberry Pi OS **with desktop** (Bookworm or Trixie). A Pi 4 or 5 is recommended; a Pi 3B+ works but is slower.

```bash
# copy this folder to the Pi, e.g. ~/Look4Sat_rPi, then:
cd ~/Look4Sat_rPi
./scripts/install.sh
```

The installer installs Chromium if it's missing and adds three menu entries and a `look4sat` command. **Nothing starts at boot, and nothing runs in the background**: the server runs only while the app is open.

| Start / stop | |
|---|---|
| Menu → **Look4Sat rPi** | Opens full screen (kiosk) |
| Menu → **Look4Sat rPi (window)** | Opens in a normal window (F11 or *Settings → System → Full screen* to toggle) |
| Menu → **Stop Look4Sat rPi** | Closes it from outside the app |
| *Settings → System → Quit* | Closes it from inside the app (works on a touchscreen in full screen) |
| `look4sat start` · `look4sat start --window` · `look4sat stop` · `look4sat status` | The same from a terminal or over SSH (with `DISPLAY`/`WAYLAND_DISPLAY` set for start) |

Closing the window in any of these ways also stops the server. Logs are in `~/.cache/look4sat-rpi/`.

On first start the app downloads satellite data, which takes about a minute. After that, set your position under **Settings → Station position**. Later starts refresh the data automatically once it is older than your *Auto update* setting (weekly by default).

| Installer option | Effect |
|---|---|
| `./scripts/install.sh --autostart` | Also opens full screen when you log in (undo by running the installer again without it) |
| `./scripts/install.sh --lan` | While it runs, a phone or laptop on your network can open `http://<pi-ip>:8642`. There is no password, so use this only on trusted networks. |
| `./scripts/uninstall.sh` | Removes the menu entries, command and autostart. Keeps the folder and your data. |
| `./scripts/run-dev.sh` | Runs only the server, on any Linux or Mac. Open the printed URL. |

**Recommended Pi settings:**
* *Raspberry Pi Configuration → Display → Screen Blanking: off* while you use it as a tracker.
* Keep the network connected, or use GPS with gpsd, so the clock stays accurate. The Pi has no RTC, and pass times depend on the clock.

## Screens

| Screen | What it does |
|---|---|
| **Satellites** | Searches the whole catalog by name or NORAD ID. Filters by **Type** (CelesTrak groups such as Amateur, Weather, NOAA, Starlink), and selects all shown or none. Tap a row to select it; tap ⓘ to see orbital elements, element age and transmitters. The ✓✓ button goes to Passes. |
| **Passes** | Lists upcoming and active passes with max elevation, altitude, AOS→LOS azimuths and a progress bar. Deep-space (GEO/HEO) satellites appear when they are visible. The top bar counts down to the next AOS (or the LOS of a pass in progress). The filter button sets hours ahead, minimum elevation and deep-space display. Tap a pass to open the Radar. |
| **Radar** | Shows a polar plot of the pass, the live satellite position and an optional sweep animation. It also shows azimuth, elevation, altitude and distance, plus SatNOGS transmitters with **doppler-corrected** downlink and uplink frequencies. The target button streams the pass to a rotator and radio (see below). |
| **Map** | Shows all selected satellites, plus the ground track (red) and footprint (yellow) of the focused one, with the day/night terminator and your station. Drag to pan, pinch or use +/− to zoom, double-tap to zoom in, tap a satellite to focus it, and use ‹ › to cycle. The crosshair button follows the focused satellite. |
| **Settings** | Covers station position (lat/lon/alt, QTH locator, GPS), data sources and updates, file import, pass filter, display, map layers, rotator, radio and gpsd, plus system controls (full screen, reload, quit). |

## Screen size, orientation and scaling

All sizes are in `rem`, and the root font size follows the screen's **short side**: 480 px gives 15 px text. This means the UI looks right on 800×480, 1024×600, 1280×720, 1920×1080 and so on.

* **Layout:** *Auto* picks a side rail in landscape and a bottom bar in portrait. You can force either.
* **Rotate screen 0/90/180/270°:** rotates the whole UI in software, touch included. Use it for a display mounted sideways when you can't or don't want to rotate it in the OS.
* **UI scale 60–200%:** adjusts the size on top of the automatic scaling.
* **Night mode:** an all-red palette for use outdoors at night.

To add a new layout, look for `.landscape` / `.portrait` in `web/css/app.css` and `applyLayout()` in `web/js/main.js`.

## On-screen keyboard

When you tap a text field, a built-in keyboard slides up, so no system keyboard is needed. Number fields get a numeric pad. If you type on a real keyboard, the on-screen one stops appearing for that session. You can also turn it off in Settings.

## Data sources

The defaults match Look4Sat. You can edit them in *Settings → Satellite data → Sources…*:

* CelesTrak `active` (OMM JSON), AMSAT `nasabare.txt`, SatNOGS DB TLEs
* SatNOGS active transmitters
* CelesTrak groups, used only to tag satellites with a type. You can turn this off for faster updates.

Supported formats are TLE, 3LE, OMM JSON, OMM CSV, SatNOGS JSON and Alpha-5 catalog numbers. When the same satellite appears in more than one source, the newest element set wins. Names come from the first source in the list.

To add your own satellites, drop `.txt`/`.tle`/`.json`/`.csv` files into `data/custom/` (or use *Import file…*), then press *Update now*.

CelesTrak asks users not to download the same data more than once every 2 hours, so auto-update is limited to daily or weekly.

## Rotator, radio and GPS (Hamlib / gpsd)

```bash
sudo apt install hamlib-utils gpsd
rotctld -m <model> -r /dev/ttyUSB0 &       # default port 4533
rigctld -m <model> -r /dev/ttyUSB1 &       # default port 4532
```

1. Turn on **Rotator (rotctld)** and/or **Radio (rigctld)** in Settings.
2. On the Radar screen, tap a transmitter to choose which downlink to tune.
3. Tap the target button to start tracking.

While tracking, the app sends `P az el` to rotctld and `F hz` (doppler-corrected, plus your offset) to rigctld about once per second.

**GPS (gpsd):** *From GPS* sets your station once. *Follow GPS position* keeps it updated as you move.

## Files

```
server.py            backend (stdlib only)
web/                 UI: index.html, css/app.css, js/*.js, vendor/satellite.esm.js
web/assets/world.json  Natural Earth 1:50m land, lakes and borders (simplified)
data/                created at runtime: state.json, catalog.json, radios.json, custom/
scripts/             look4sat.sh (start/stop launcher), install, uninstall, run-dev
tests/fake_net.py    runs the server against synthetic offline data
tests/shots.py       Playwright screenshots of every screen at any size
```

## Accuracy

Pass search uses an adaptive coarse scan, bisection to 1 s for AOS and LOS, and a golden-section search for maximum elevation. Compared with a brute-force 1-second scan over 24 hours (15 satellites from LEO to Molniya, 0° minimum), it missed no passes. AOS and LOS were within about 2 s, and maximum elevation within 0.01°.

## Credits

* [Look4Sat](https://github.com/rt-bishop/Look4Sat) by Arty Bishop (GPL-3.0), the inspiration for the design and features. No code was copied.
* [satellite.js](https://github.com/shashwatak/satellite-js) (MIT): SGP4/SDP4.
* [Natural Earth](https://www.naturalearthdata.com/): public-domain map data.
* [Roboto](https://fonts.google.com/specimen/Roboto) (OFL).
* Orbital data from [CelesTrak](https://celestrak.org), [AMSAT](https://www.amsat.org) and [SatNOGS](https://satnogs.org).
