// Delegated styled tooltip — ONE module upgrades every `title` attribute in
// the app to a themed, instant-feedback tooltip without touching call sites.
//
// How it works:
//   1. A MutationObserver moves `title` → `data-tip` (the native tooltip must
//      not fire, but the semantic attribute stays the data source — call sites
//      keep writing `title` and never learn about this module).
//   2. Icon-only elements also get aria-label so screen-reader semantics
//      survive the move.
//   3. mouseover/focusin show a single floating tip (350ms delay, clamped to
//      the viewport, theme-aware via tokens); leaving/scrolling hides it.
//
// Install once at boot: `installTooltips()`.

const TOOLTIP_CSS = `
.app-tooltip {
  position: fixed;
  z-index: 400;
  max-width: 340px;
  padding: 6px 10px;
  background: var(--bg4);
  color: var(--text);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  font-size: var(--fs-body);
  line-height: 1.45;
  white-space: pre-line;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.app-tooltip.app-tooltip-show { opacity: 1; }
`;

let installed = false;

export function installTooltips(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const style = document.createElement('style');
  style.textContent = TOOLTIP_CSS;
  document.head.append(style);

  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  tip.setAttribute('role', 'tooltip');
  let tipFor: Element | null = null;
  let showTimer = 0;
  document.body.append(tip);

  const hide = () => {
    window.clearTimeout(showTimer);
    tip.classList.remove('app-tooltip-show');
    tipFor = null;
  };

  const show = (target: Element) => {
    const text = (target as HTMLElement).dataset.tip;
    if (!text) return;
    tipFor = target;
    tip.textContent = text;
    const r = target.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    // Prefer above; flip below when clipped; clamp horizontally.
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));
    let y = r.top - th - 6;
    if (y < 6) y = r.bottom + 6;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
    tip.classList.add('app-tooltip-show');
  };

  const schedule = (target: Element) => {
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(target), 350);
  };

  document.addEventListener('mouseover', (e) => {
    const target = (e.target as Element | null)?.closest?.('[data-tip]');
    if (target === tipFor) return;
    if (target) schedule(target);
    else hide();
  });
  document.addEventListener('focusin', (e) => {
    const target = (e.target as Element | null)?.closest?.('[data-tip]');
    if (target) show(target); // keyboard: no delay
    else hide();
  });
  document.addEventListener('mousedown', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('scroll', hide, true);

  // Move title → data-tip (and aria-label for icon-only elements) wherever it
  // appears, now and in the future.
  const adopt = (el: Element) => {
    const title = el.getAttribute('title');
    if (!title) return;
    el.setAttribute('data-tip', title);
    el.removeAttribute('title');
    if (!el.textContent?.trim() && !el.hasAttribute('aria-label')) {
      el.setAttribute('aria-label', title);
    }
  };
  const scan = (root: Node) => {
    if (!(root instanceof Element)) return;
    if (root.hasAttribute('title')) adopt(root);
    root.querySelectorAll('[title]').forEach(adopt);
  };
  scan(document.body);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') adopt(m.target as Element);
      else m.addedNodes.forEach(scan);
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  });
}
