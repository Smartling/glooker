// GLOOK-64: the Security page tokens exist for dark (:root) AND light (the bare
// [data-theme-mode="light"] block) with the spec's values, and the utility classes read them.
import fs from 'fs';
import path from 'path';

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

const dark = extractBlock(css, /^:root\s*{$/);
// The bare selector exactly, not one of the many `[data-theme-mode="light"] .foo {` rules.
const light = extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/);

const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase();
function token(block: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`--${name} not defined in the block`);
  return norm(m[1]);
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const DARK = {
  warn: '#d29922', 'warn-bg': 'rgba(210,153,34,.11)', 'warn-line': 'rgba(210,153,34,.45)',
  'crit-tint': 'rgba(239,68,68,.045)', 'high-tint': 'rgba(251,146,60,.04)',
};
const LIGHT = {
  'warn-bg': '#fbefc6', 'warn-line': 'rgba(154,103,0,.32)', 'crit-tint': '#fef7f7', 'high-tint': '#fffaf5',
};

it('defines the five tokens at :root with the spec dark values', () => {
  for (const [name, value] of Object.entries(DARK)) expect(token(dark, name)).toBe(value);
});

it('defines the five tokens under the bare light block with the spec light values', () => {
  for (const [name, value] of Object.entries(LIGHT)) expect(token(light, name)).toBe(value);
});

it('light --warn is a 6-digit hex no lighter than the spec value #9a6700 (darkened to pass contrast, never lightened)', () => {
  const v = token(light, 'warn');
  expect(v).toMatch(/^#[0-9a-f]{6}$/);
  expect(luminance(v)).toBeLessThanOrEqual(luminance('#9a6700'));
});

describe('utility classes read the tokens', () => {
  const UTILITIES: Array<[string, RegExp]> = [
    ['.text-warn', /\.text-warn\s*\{\s*color:\s*var\(--warn\);\s*\}/],
    ['.bg-warn-bg', /\.bg-warn-bg\s*\{\s*background-color:\s*var\(--warn-bg\);\s*\}/],
    ['.border-warn-line', /\.border-warn-line\s*\{\s*border-color:\s*var\(--warn-line\);\s*\}/],
    ['.bg-crit-tint', /\.bg-crit-tint\s*\{\s*background-color:\s*var\(--crit-tint\);\s*\}/],
    ['.bg-high-tint', /\.bg-high-tint\s*\{\s*background-color:\s*var\(--high-tint\);\s*\}/],
  ];
  it.each(UTILITIES)('%s', (_name, re) => {
    expect(css).toMatch(re);
  });

  it('.vuln-hatch layers --warn-line stripes over the --warn-bg wash', () => {
    expect(css).toMatch(/\.vuln-hatch\s*\{[^}]*background-color:\s*var\(--warn-bg\)[^}]*repeating-linear-gradient\([^}]*var\(--warn-line\)[^}]*\}/);
  });
});
