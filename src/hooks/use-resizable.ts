// Reusable width-resize controller for vertical panels. Supports pointer
// dragging and keyboard arrows, clamps to a min/max range and persists the
// result through the preference store. `edge` states which side of the panel
// the separator sits on, fixing the drag/arrow direction.
import { useCallback, useRef, useState } from 'react';
import { getPref, hasPref, setPref } from '../lib/prefs';

interface ResizableOptions {
  prefKey: string;
  initial: number;
  min: number;
  max: number;
  edge: 'left' | 'right';
  label: string;
}

const KEYBOARD_STEP = 20;
const KEYBOARD_BIG_STEP = 48;

export function useResizable({ prefKey, initial, min, max, edge, label }: ResizableOptions) {
  const [width, setWidth] = useState<number>(() => getPref(prefKey, initial));
  // Whether the user has ever chosen a width. Until then no inline width is
  // applied, so the responsive media queries keep controlling the panel.
  const [custom, setCustom] = useState<boolean>(() => hasPref(prefKey));
  // +1 for a handle on the panel's right edge (drag right to widen), -1 for a
  // handle on the left edge (drag left to widen).
  const sign = edge === 'right' ? 1 : -1;

  // Mirror the latest width so imperative event handlers can read and persist
  // it without running side effects inside a setState updater.
  const widthRef = useRef(width);
  widthRef.current = width;

  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const element = event.currentTarget;
    element.classList.add('dragging');
    // First-ever drag: the panel is still sized by the responsive media
    // queries (custom=false, no inline width), so setWidth alone would only
    // take effect at pointerup. Take over from the panel's CURRENT rendered
    // width and apply the inline style immediately, so the very first drag
    // tracks the pointer live like every later one.
    // The separator renders INSIDE the panel it resizes (first child), so
    // the panel is the parent element.
    const panel = element.parentElement as HTMLElement | null;
    const startW = panel?.getBoundingClientRect().width ?? widthRef.current;
    setWidth(startW);
    setCustom(true);
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      setWidth(clamp(startW + sign * (ev.clientX - startX)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      element.classList.remove('dragging');
      if (moved) {
        // Persist only when the drag actually moved, not on a bare click.
        setPref(prefKey, widthRef.current);
      } else if (!hasPref(prefKey)) {
        // A bare click on a never-customized panel must not freeze the
        // media-query width; hand control back to the responsive rules.
        setCustom(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [clamp, prefKey, sign]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    let delta = 0;
    const step = event.shiftKey ? KEYBOARD_BIG_STEP : KEYBOARD_STEP;
    if (event.key === 'ArrowRight') delta = sign * step;
    else if (event.key === 'ArrowLeft') delta = -sign * step;
    if (!delta) return;
    event.preventDefault();
    const next = clamp(widthRef.current + delta);
    setWidth(next);
    setPref(prefKey, next);
    setCustom(true);
  }, [clamp, prefKey, sign]);

  const separatorProps = {
    role: 'separator',
    'aria-orientation': 'vertical' as const,
    'aria-label': label,
    'aria-valuenow': width,
    'aria-valuemin': min,
    'aria-valuemax': max,
    tabIndex: 0,
    onPointerDown,
    onKeyDown,
  };

  return { width, widthStyle: custom ? { width } : undefined, separatorProps };
}
