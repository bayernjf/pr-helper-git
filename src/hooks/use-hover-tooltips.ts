import { useEffect } from 'react';

// Toolbar-only hover tooltips: [data-tip] elements share one fixed-positioned
// tooltip that renders BELOW the trigger (never covering the button itself,
// unlike native title tooltips) and clamps to the viewport edges — centered
// under the trigger when there is room, pinned to an 8px margin otherwise.
let tip: HTMLDivElement | null = null;
let showTimer: number | undefined;
let hideTimer: number | undefined;
let active: HTMLElement | null = null;

function tipEl(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'hover-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function hide() {
  window.clearTimeout(showTimer);
  window.clearTimeout(hideTimer);
  active = null;
  tip?.classList.remove('show');
}

function show(trigger: HTMLElement) {
  const text = trigger.getAttribute('data-tip') || '';
  if (!text) return;
  const el = tipEl();
  // Text lives in an inner span: the ellipsis clipping stays on the span so
  // the ::before arrow can protrude above the box (overflow must stay
  // visible on the tip itself).
  el.textContent = '';
  const textSpan = document.createElement('span');
  textSpan.className = 'hover-tip-text';
  textSpan.textContent = text;
  el.appendChild(textSpan);
  el.style.visibility = 'hidden';
  el.classList.add('show');
  // Measure a frame after layout so the clamp uses real dimensions.
  requestAnimationFrame(() => {
    if (active !== trigger) return;
    const r = trigger.getBoundingClientRect();
    const tr = el.getBoundingClientRect();
    const MARGIN = 8;
    const center = r.left + r.width / 2;
    let left = center - tr.width / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tr.width - MARGIN));
    el.style.left = `${Math.round(left)}px`;
    // Arrow points at the trigger; when the tip is edge-clamped the arrow
    // stays above the trigger as long as it remains inside the tip box.
    const arrowX = Math.max(14, Math.min(center - left, tr.width - 14));
    el.style.setProperty('--tip-arrow-x', `${Math.round(arrowX)}px`);
    el.style.top = `${Math.round(r.bottom + 5)}px`;
    el.style.visibility = 'visible';
  });
}

/** Mounted once at the app root, next to useFocusTrap. */
export function useHoverTooltips() {
  useEffect(() => {
    const over = (e: MouseEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!t || !t.getAttribute('data-tip')) return;
      window.clearTimeout(hideTimer);
      if (active === t) return;
      active = t;
      window.clearTimeout(showTimer);
      showTimer = window.setTimeout(() => show(t), 300);
    };
    const out = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-tip]')) {
        window.clearTimeout(showTimer);
        hideTimer = window.setTimeout(hide, 80);
      }
    };
    const onScroll = () => hide();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    // Any click (opening a menu, pressing a button) retires the tip
    // immediately — a tooltip must never sit on top of an opened menu.
    const onClick = () => hide();
    document.addEventListener('click', onClick, true);
    document.addEventListener('mouseover', over, true);
    document.addEventListener('mouseout', out, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', onScroll);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mouseout', out, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', onScroll);
      document.removeEventListener('keydown', onKey);
      hide();
    };
  }, []);
}
