// @vitest-environment jsdom
// The dropdown menu is portaled to <body> so a toolbar with overflow clipping
// cannot cut the options off; selecting an option must still close it.
import { createElement } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dropdown } from './Dropdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function renderDropdown(onChange = vi.fn()) {
  act(() => {
    root?.render(
      createElement(
        'div',
        { style: { overflow: 'hidden', height: '20px' } },
        createElement(Dropdown, {
          value: 'a',
          onChange,
          options: [
            { value: 'a', label: 'alpha' },
            { value: 'b', label: 'beta' },
          ],
        }),
      ),
    );
  });
  return onChange;
}

describe('Dropdown', () => {
  it('renders the open menu in a portal outside the clipping container', () => {
    renderDropdown();
    const trigger = document.querySelector('.dropdown-trigger') as HTMLButtonElement;
    act(() => trigger.click());

    const menu = document.querySelector('.dropdown-menu');
    expect(menu).not.toBeNull();
    expect(menu?.parentElement).toBe(document.body);
    expect(document.querySelector('.dropdown')?.contains(menu as Node)).toBe(false);
    expect(menu?.textContent).toContain('alpha');
    expect(menu?.textContent).toContain('beta');
  });

  it('commits the clicked option and closes the menu', () => {
    const onChange = renderDropdown();
    const trigger = document.querySelector('.dropdown-trigger') as HTMLButtonElement;
    act(() => trigger.click());

    const beta = [...document.querySelectorAll('.dropdown-item')]
      .find((el) => el.textContent === 'beta') as HTMLElement;
    act(() => beta.click());

    expect(onChange).toHaveBeenCalledWith('b');
    expect(document.querySelector('.dropdown-menu')).toBeNull();
  });
});
