import { h, icon, fmtCountdown, fmtTime, fmtDate, fmtAz, fmtDeg } from '../ui.js';

/** The big "AOS 00:06:32 LOS" countdown used in the top bars. */
export function timerBox() {
  const aos = h('span', { class: 't-tag' }, 'AOS');
  const val = h('span', { class: 't-val' }, '--:--:--');
  const los = h('span', { class: 't-tag' }, 'LOS');
  const sub = h('div', { class: 't-sub' }, '');
  const el = h('div', { class: 'timer' }, h('div', { class: 't-main' }, aos, val, los), sub);
  return {
    el,
    update(pass, now, subText) {
      if (!pass || pass.deep) {
        val.textContent = pass?.deep ? 'DEEP SPACE' : '--:--:--';
        aos.classList.remove('on'); los.classList.remove('on');
        el.classList.toggle('long', !!pass?.deep);
      } else {
        el.classList.remove('long');
        const active = pass.aos <= now;
        val.textContent = fmtCountdown((active ? pass.los : pass.aos) - now);
        aos.classList.toggle('on', !active);
        los.classList.toggle('on', active);
      }
      sub.textContent = subText ?? (pass ? `${pass.id} - ${pass.name}` : 'No upcoming passes');
    },
  };
}

export function elevClass(el) {
  if (el >= 45) return 'el-high';
  if (el < 15) return 'el-low';
  return 'el-mid';
}

/** Look4Sat-style pass card. Returns {el, update(now)}. */
export function passCard(p, { compact = false } = {}) {
  const bar = h('div', { class: 'bar' }, h('div', { class: 'bar-fill' }));
  const fill = bar.firstChild;
  const card = h('div', { class: 'card pass' + (p.deep ? ' deep' : '') + (compact ? ' compact' : '') },
    h('div', { class: 'row' },
      h('span', { class: 'title' }, h('span', { class: 'accent' }, p.id), ' - ', h('span', { class: 'name' }, p.name)),
      h('span', { class: 'max ' + elevClass(p.maxEl) }, icon('elev', 'sm'), fmtDeg(p.maxEl))),
    h('div', { class: 'row sub' },
      h('span', {}, p.deep ? 'Deep space' : fmtDate(p.aos)),
      h('span', { class: 'altv' }, icon('alt', 'sm'), Math.round(p.alt) + ' km'),
      h('span', {}, `${fmtAz(p.aosAz)} - ${fmtAz(p.losAz)}`)),
    compact ? null : h('div', { class: 'row times' },
      h('span', { class: 'tm' }, p.deep ? '--:--' : fmtTime(p.aos)), bar, h('span', { class: 'tm' }, p.deep ? '--:--' : fmtTime(p.los))),
  );
  const update = (now) => {
    if (compact) return;
    let f = 0;
    if (p.deep) f = 1;
    else if (now >= p.los) f = 1;
    else if (now > p.aos) f = (now - p.aos) / (p.los - p.aos);
    fill.style.transform = `scaleX(${f.toFixed(4)})`;
    card.classList.toggle('active', p.deep || (now >= p.aos && now < p.los));
  };
  update(Date.now());
  return { el: card, update, pass: p };
}
