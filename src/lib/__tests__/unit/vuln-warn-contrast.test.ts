// GLOOK-64: --warn is used as text (the "UNMEASURED" and "STALE" tags, 11px+), so it needs WCAG AA
// 4.5:1 on its own wash (--warn-bg) and on every body background of its mode. Pattern copied from
// vuln-series-contrast.test.ts, extended to parse the dark mode's rgba() wash and composite it over
// each body background before measuring.
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

type Rgba = [number, number, number, number];

function tokenValue(block: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`--${name} not defined in the block`);
  return m[1].trim();
}

function parseColor(v: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(v);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`unsupported colour: ${v}`);
}

/** fg drawn over an opaque bg. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function channelLuminance(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function relativeLuminance([r, g, b]: Rgba): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}
function contrast(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const blocks = {
  dark: extractBlock(css, /^:root\s*{$/),
  light: extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/),
};
const bodyBgs: Record<'dark' | 'light', string[]> = { dark: [], light: [] };
for (const t of THEMES) bodyBgs[t.mode].push(t.bodyBg);

const MIN_CONTRAST = 4.5;

describe('the contrast helper itself', () => {
  it("detects the failure the spec anticipated: its light value #9a6700 on #fbefc6 is below 4.5:1", () => {
    expect(contrast(parseColor('#9a6700'), parseColor('#fbefc6'))).toBeLessThan(MIN_CONTRAST);
  });
  it('composites the dark wash over the body background before measuring', () => {
    const wash = over(parseColor('rgba(210,153,34,.11)'), parseColor('#0F0F0F'));
    expect(wash[0]).toBeGreaterThan(15); // lighter than the plain #0F0F0F background
  });
  it('has dark and light body backgrounds to check against', () => {
    expect(bodyBgs.dark.length).toBeGreaterThan(0);
    expect(bodyBgs.light.length).toBeGreaterThan(0);
  });
});

describe.each(['dark', 'light'] as const)('--warn text contrast in %s mode', mode => {
  const warn = parseColor(tokenValue(blocks[mode], 'warn'));
  const warnBg = parseColor(tokenValue(blocks[mode], 'warn-bg'));

  it.each(bodyBgs[mode])('on the --warn-bg wash over body background %s', bg => {
    const page = parseColor(bg);
    expect(contrast(warn, over(warnBg, page))).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it.each(bodyBgs[mode])('directly on body background %s', bg => {
    expect(contrast(warn, parseColor(bg))).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});
