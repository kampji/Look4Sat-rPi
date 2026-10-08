// Pass prediction runs here so the UI never stutters, even with hundreds of satellites.
import { observer } from './orbit.js';
import { passesFor, aosInWindow } from './predict.js';

self.onmessage = (ev) => {
  const { reqId, entries, station, hoursAhead, minEl, showDeep, now, window } = ev.data;
  const obs = observer(station);
  const end = now + hoursAhead * 3600 * 1000;
  const t0 = performance.now();
  let passes = [];
  for (const e of entries) {
    try {
      passes = passes.concat(passesFor(e, obs, now, end, minEl, showDeep));
    } catch (err) {
      // ignore broken element sets
    }
  }
  if (window) passes = passes.filter((p) => p.deep || aosInWindow(p.aos, window));
  passes.sort((a, b) => (a.deep === b.deep ? a.aos - b.aos : a.deep ? -1 : 1));
  self.postMessage({ reqId, passes, ms: Math.round(performance.now() - t0) });
};
