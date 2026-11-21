import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('../design/tokens.css', import.meta.url), 'utf8');

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

describe('spacing and control tokens', () => {
  it('generates the spacing scale and control metrics from tokens.json', () => {
    for (const token of ['--space-2:', '--space-8:', '--space-16:', '--space-40:']) {
      expect(tokensCss).toContain(token);
    }
    for (const token of ['--control-height:', '--control-height-compact:', '--control-padding-x:', '--control-padding-y:']) {
      expect(tokensCss).toContain(token);
    }
    expect(tokensCss).toContain('--control-padding-x: 12px;');
    expect(tokensCss).toContain('--radius-control: 7px;');
  });

  it('keeps settings fields and compact buttons on the control rhythm', () => {
    expect(css).toContain('padding: var(--control-padding-y) var(--control-padding-x)');
    expect(css).toContain('height: var(--control-height)');
    expect(css).toContain('height: var(--control-height-compact)');
    expect(css).not.toContain('padding: 5px 9px');
  });

  it('keeps settings rows and panes on the spacing scale', () => {
    expect(css).toContain('padding: var(--space-12) var(--space-14)');
    expect(css).toContain('padding: var(--space-28) var(--space-30) var(--space-40)');
    expect(css).toContain('gap: var(--space-16)');
  });
});
