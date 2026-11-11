import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('theme token aliases', () => {
  it('resolves legacy surface names through shared design tokens', () => {
    const aliases: Record<string, string> = {
      '--bg': '--bg0',
      '--panel': '--bg1',
      '--panel-2': '--bg2',
      '--bg-elevated': '--bg2',
      '--hover': '--bg3',
      '--active': '--bg4',
      '--border-soft': '--hairline',
      '--muted': '--text-dim',
      '--faint': '--text-faint',
    };
    for (const [name, token] of Object.entries(aliases)) {
      expect(css).toContain(`${name}: var(${token})`);
    }
  });

  it('does not re-declare dark surface colors after the alias layer', () => {
    for (const name of ['--bg', '--panel', '--panel-2', '--bg-elevated', '--hover', '--active']) {
      expect(css).not.toContain(`${name}: #`);
    }
  });
});
