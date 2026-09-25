// src/lib/__tests__/unit/chart-contrast.test.ts
// GLOOK-58 guard test 3: every contrast threshold in spec Decision 14, in both modes.
//   - Fixed mark palettes (commit types, lines, ring, scatter, volume prs/jiras) >= 3:1 against
//     the card surface.
//   - Ring colours >= 3:1 against --chart-track, the surface they are drawn over.
//   - All ten theme accents >= 3:1 against their own mode's card surface (single-metric timelines
//     are drawn in var(--accent)).
//   - --chart-axis >= 4.5:1 against the card; --chart-tooltip-text >= 4.5:1 against --chart-tooltip-bg.
//   - Commit-type badge text >= 4.5:1 against its own badge fill, all 8 types.
// --chart-grid and --chart-tooltip-border are exempt (decorative; Decision 14), so the grid can
// stay recessive. Colour-blind separation is checked by the dataviz validator and recorded in the
// spec's Palette section.
import fs from 'fs';
import path from 'path';
import { THEMES } from '@/app/themes';

const css = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

function extractBlock(source: string, selectorLine: RegExp): string {
  const lines = source.split('\n');
  const start = lines.findIndex(l => selectorLine.test(l.trim()));
  if (start === -1) throw new Error(`selector not found: ${selectorLine}`);
  let depth = 0;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i]);
    depth += (lines[i].match(/{/g) || []).length;
    depth -= (lines[i].match(/}/g) || []).length;
    if (i > start && depth <= 0) break;
  }
  return out.join('\n');
}

function parseHexVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--(chart-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out[m[1]] = m[2].toLowerCase();
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// WCAG relative luminance: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const modes = {
  dark: parseHexVars(extractBlock(css, /^:root\s*{$/)),
  light: parseHexVars(extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/)),
} as const;

const TYPES = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in-flight'];
const FIXED = [
  ...TYPES.map(t => `chart-type-${t}`),
  'chart-lines-added', 'chart-lines-removed',
  'chart-ring-jira', 'chart-ring-commits',
  'chart-scatter-typical', 'chart-scatter-outlier',
  'chart-volume-prs', 'chart-volume-jiras',
];

type Pair = [label: string, a: string, b: string, min: number];
function check(pairs: Pair[]): string[] {
  return pairs
    .filter(([, a, b, min]) => contrast(a, b) < min)
    .map(([label, a, b, min]) => `${label}: ${a} vs ${b} = ${contrast(a, b).toFixed(2)} (< ${min})`);
}

describe.each(['dark', 'light'] as const)('%s mode chart contrast', mode => {
  const v = modes[mode];

  it('--chart-surface is the card colour charts sit on (dark bg-gray-900 #111827, light card #ffffff)', () => {
    expect(v['chart-surface']).toBe(mode === 'dark' ? '#111827' : '#ffffff');
  });

  it('fixed mark palettes clear 3:1 against the card surface', () => {
    expect(check(FIXED.map(t => [`--${t}`, v[t], v['chart-surface'], 3] as Pair))).toEqual([]);
  });

  it('ring colours clear 3:1 against --chart-track', () => {
    expect(check([
      ['--chart-ring-jira vs track', v['chart-ring-jira'], v['chart-track'], 3],
      ['--chart-ring-commits vs track', v['chart-ring-commits'], v['chart-track'], 3],
    ])).toEqual([]);
  });

  it('every theme accent in this mode clears 3:1 against the card surface', () => {
    const accents = THEMES.filter(t => t.mode === mode);
    expect(accents.length).toBeGreaterThan(0);
    expect(check(accents.map(t => [`${t.id} accent`, t.accent.toLowerCase(), v['chart-surface'], 3] as Pair))).toEqual([]);
  });

  it('chrome text clears 4.5:1 against its own background', () => {
    expect(check([
      ['--chart-axis vs surface', v['chart-axis'], v['chart-surface'], 4.5],
      ['--chart-tooltip-text vs tooltip-bg', v['chart-tooltip-text'], v['chart-tooltip-bg'], 4.5],
    ])).toEqual([]);
  });

  it('every commit-type badge has text at 4.5:1 against its own fill', () => {
    expect(check(TYPES.map(t => [`badge ${t}`, v[`chart-badge-${t}-text`], v[`chart-badge-${t}-bg`], 4.5] as Pair))).toEqual([]);
  });

  it('neither scatter colour is the commit-type bug red', () => {
    expect(v['chart-scatter-typical']).not.toBe(v['chart-type-bug']);
    expect(v['chart-scatter-outlier']).not.toBe(v['chart-type-bug']);
  });
});
