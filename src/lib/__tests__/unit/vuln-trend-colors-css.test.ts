// src/lib/__tests__/unit/vuln-trend-colors-css.test.ts
// globals.css defines the 13 trend-series colour variables at :root (dark palette, the
// app's default) and overrides all 13 under [data-theme-mode="light"] (light palette) — the
// app's existing convention for light-mode colours (no component reads useTheme() for colours).
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

const DARK = ['#f87171', '#60a5fa', '#4ade80', '#c084fc', '#fbbf24', '#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#2dd4bf', '#818cf8', '#fda4af'];
// #6b7280 failed WCAG AA text contrast (4.5:1) against this palette's dark bodyBgs; #9ca3af clears it.
const DARK_OTHER = '#9ca3af';
// series-3/6/7/9/10 failed WCAG AA text contrast (4.5:1) against this palette's light bodyBgs;
// each was swapped for a darker (series-7: fuchsia, not darker pink) shade that clears it.
const LIGHT = ['#dc2626', '#2563eb', '#15803d', '#9333ea', '#b45309', '#0e7490', '#a21caf', '#4d7c0f', '#c2410c', '#0f766e', '#4f46e5', '#be123c'];
const LIGHT_OTHER = '#6b7280';

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

it('defines --vuln-series-1..12 and --vuln-series-other at :root with the exact dark palette', () => {
  const root = extractBlock(css, /^:root\s*{$/);
  DARK.forEach((hex, i) => {
    expect(root).toMatch(new RegExp(`--vuln-series-${i + 1}:\\s*${hex}\\s*;`, 'i'));
  });
  expect(root).toMatch(new RegExp(`--vuln-series-other:\\s*${DARK_OTHER}\\s*;`, 'i'));
});

it('overrides all 13 variables under the bare [data-theme-mode="light"] block with the exact light palette', () => {
  // Match the bare selector exactly, not one of the many `[data-theme-mode="light"] .foo {` rules.
  const light = extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/);
  LIGHT.forEach((hex, i) => {
    expect(light).toMatch(new RegExp(`--vuln-series-${i + 1}:\\s*${hex}\\s*;`, 'i'));
  });
  expect(light).toMatch(new RegExp(`--vuln-series-other:\\s*${LIGHT_OTHER}\\s*;`, 'i'));
});
