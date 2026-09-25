// src/lib/__tests__/unit/vuln-series-contrast.test.ts
// the trend-chart legend renders each series colour as 11px text (WCAG AA needs 4.5:1 for
// text; the polyline/dot themselves are graphics, which only need 3:1 and are out of scope here).
// This asserts every --vuln-series-* custom property in globals.css meets 4.5:1 against every
// theme's bodyBg (src/app/themes.ts) in its own mode — not just the specific colours previously
// flagged as failing, so a future palette edit can't reintroduce a contrast failure unnoticed.
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

function parseSeriesVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--(vuln-series-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out[m[1]] = m[2].toLowerCase();
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// WCAG relative luminance: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function channelLuminance(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const darkBlock = extractBlock(css, /^:root\s*{$/);
// Match the bare selector exactly, not one of the many `[data-theme-mode="light"] .foo {` rules.
const lightBlock = extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/);
const darkVars = parseSeriesVars(darkBlock);
const lightVars = parseSeriesVars(lightBlock);

const bodyBgsByMode: Record<'dark' | 'light', string[]> = { dark: [], light: [] };
for (const t of THEMES) bodyBgsByMode[t.mode].push(t.bodyBg);

const MIN_CONTRAST = 4.5;

describe('--vuln-series-* legend colours meet WCAG AA text contrast (4.5:1)', () => {
  it('has at least one dark and one light bodyBg to check against (sanity check on the fixture itself)', () => {
    expect(bodyBgsByMode.dark.length).toBeGreaterThan(0);
    expect(bodyBgsByMode.light.length).toBeGreaterThan(0);
  });

  it('every dark-mode series colour has contrast >= 4.5 against every dark theme bodyBg', () => {
    const failures: string[] = [];
    for (const [name, hex] of Object.entries(darkVars)) {
      for (const bg of bodyBgsByMode.dark) {
        const c = contrastRatio(hex, bg);
        if (c < MIN_CONTRAST) failures.push(`--${name} (${hex}) vs ${bg}: ${c.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('every light-mode series colour has contrast >= 4.5 against every light theme bodyBg', () => {
    const failures: string[] = [];
    for (const [name, hex] of Object.entries(lightVars)) {
      for (const bg of bodyBgsByMode.light) {
        const c = contrastRatio(hex, bg);
        if (c < MIN_CONTRAST) failures.push(`--${name} (${hex}) vs ${bg}: ${c.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
