import { h, icon, fmtCountdown, fmtTime, fmtAz, fmtDeg, fmtDuration, elClass } from '../ui.js';

/** The big "AOS 00:06:32 LOS" countdown used in the Radar / Map / ISS top bars. */
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

export const elevBadge = (el, cls = '') => h('span', { class: `elev ${elClass(el)} ${cls}` }, icon('elev', 'sm'), fmtDeg(el));

/** "AOS 00:12:34" (grey) / "LOS 00:05:12" (accent) chip. */
export function timerChip(p) {
  const chip = h('span', { class: 'chip-timer' });
  const update = (now) => {
    if (p.deep) { chip.textContent = 'DeepSpace'; chip.classList.remove('on'); return; }
    const active = now >= p.aos;
    chip.textContent = active ? `LOS ${fmtCountdown(p.los - now)}` : `AOS ${fmtCountdown(p.aos - now)}`;
    chip.classList.toggle('on', active);
  };
  update(Date.now());
  return { el: chip, update };
}

/** Pass card in the layout of the current Look4Sat release. Returns {el, update(now)}. */
export function passCard(p) {
  const chip = timerChip(p);
  const bar = h('div', { class: 'bar' }, h('div', { class: 'bar-fill' }));
  const fill = bar.firstChild;
  const card = h('div', { class: 'card pass' + (p.deep ? ' deep' : '') },
    h('div', { class: 'row' },
      h('span', { class: 'title' }, h('span', { class: 'accent' }, `${p.id} - `), h('span', { class: 'name' }, p.name)),
      chip.el),
    h('div', { class: 'row sub' },
      h('span', { class: 'grow' }, p.deep ? '--m --s' : fmtDuration(p.los - p.aos)),
      h('span', { class: 'arc' }, h('span', {}, fmtAz(p.aosAz)), elevBadge(p.maxEl), h('span', {}, fmtAz(p.losAz))),
      h('span', { class: 'grow right' }, Math.round(p.alt) + ' km')),
    p.deep ? null : h('div', { class: 'row times' }, h('span', { class: 'tm' }, fmtTime(p.aos)), bar, h('span', { class: 'tm' }, fmtTime(p.los))),
  );
  const update = (now) => {
    chip.update(now);
    if (p.deep) { card.classList.add('active'); return; }
    let f = 0;
    if (now >= p.los) f = 1;
    else if (now > p.aos) f = (now - p.aos) / (p.los - p.aos);
    fill.style.transform = `scaleX(${f.toFixed(4)})`;
    card.classList.toggle('active', now >= p.aos && now < p.los);
  };
  update(Date.now());
  return { el: card, update, pass: p };
}

/** Compact "next pass" card for the Passes top bar (Look4Sat NextPassRow + countdown). */
export function nextPassBox() {
  const title = h('span', { class: 'np-title' });
  const elev = h('span');
  const chipWrap = h('span');
  const sub = h('div', { class: 'np-sub' });
  const el = h('div', { class: 'tile next-pass' }, h('div', { class: 'np-row' }, title, elev, chipWrap), sub);
  let cur = null, chip = null;
  return {
    el,
    update(p, now) {
      if (p !== cur) {
        cur = p;
        title.innerHTML = '';
        elev.innerHTML = '';
        chipWrap.innerHTML = '';
        if (!p) { title.textContent = 'No upcoming passes'; sub.textContent = ''; chip = null; return; }
        title.append(h('span', { class: 'accent' }, `${p.id} - `), p.name);
        elev.append(elevBadge(p.maxEl));
        chip = timerChip(p);
        chipWrap.append(chip.el);
        sub.innerHTML = '';
        sub.append(h('span', {}, p.deep ? 'DeepSpace' : fmtTime(p.aos)), h('span', {}, Math.round(p.alt) + ' km'), h('span', {}, `${fmtAz(p.aosAz)} - ${fmtAz(p.losAz)}`));
      }
      chip?.update(now);
    },
  };
}
