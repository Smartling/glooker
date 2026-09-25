// src/lib/__tests__/unit/chart-tokens-css.test.ts
// GLOOK-58 guard test 2: every --chart-* token is defined for dark (:root) AND light (the bare
// [data-theme-mode="light"] block), as a 6-digit hex, and every var(--chart-*) that chart code or
// the Tailwind config references actually exists. A token missing from the light block would fall
// back to the dark value and put dark internals inside a light card, the bug this ticket fixes.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../../../..');
const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');

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

function chartTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--(chart-[a-z0-9-]+):\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}

const dark = chartTokens(extractBlock(css, /^:root\s*{$/));
// Match the bare selector exactly, not one of the many `[data-theme-mode="light"] .foo {` rules.
const light = chartTokens(extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/));

const TYPES = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in-flight'];
const REQUIRED = [
  'chart-grid', 'chart-axis', 'chart-cursor', 'chart-tooltip-bg', 'chart-tooltip-border',
  'chart-tooltip-text', 'chart-track', 'chart-surface',
  ...TYPES.map(t => `chart-type-${t}`),
  'chart-lines-added', 'chart-lines-removed',
  'chart-ring-jira', 'chart-ring-commits',
  'chart-scatter-typical', 'chart-scatter-outlier',
  'chart-volume-prs', 'chart-volume-jiras', 'chart-volume-commits',
  ...TYPES.flatMap(t => [`chart-badge-${t}-bg`, `chart-badge-${t}-text`]),
];

// Files whose var(--chart-*) references must resolve. Missing files are skipped, so this test can
// land before the chart modules exist and tightens as they arrive.
const REFERENCING_FILES = [
  'tailwind.config.ts',
  'src/app/vulnerabilities/trend-chart.tsx',
  'src/app/projects/progress-ring.tsx',
  'src/components/ProjectsCard.tsx',
];
const CHART_DIR = path.join(root, 'src/components/charts');

function referencedTokens(): Array<{ file: string; token: string }> {
  const files = REFERENCING_FILES.map(f => path.join(root, f));
  if (fs.existsSync(CHART_DIR)) {
    for (const f of fs.readdirSync(CHART_DIR)) files.push(path.join(CHART_DIR, f));
  }
  const out: Array<{ file: string; token: string }> = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/var\(--(chart-[a-z0-9-]+)\)/g)) out.push({ file: path.relative(root, file), token: m[1] });
  }
  return out;
}

it('defines every required --chart-* token under :root (dark)', () => {
  expect(REQUIRED.filter(t => !(t in dark))).toEqual([]);
});

it('defines exactly the same --chart-* tokens under the bare light block as under :root', () => {
  expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
});

it('every --chart-* value in both modes is a 6-digit hex (the contrast guard only parses that form)', () => {
  const bad = [
    ...Object.entries(dark).filter(([, v]) => !/^#[0-9a-fA-F]{6}$/.test(v)).map(([k, v]) => `dark --${k}: ${v}`),
    ...Object.entries(light).filter(([, v]) => !/^#[0-9a-fA-F]{6}$/.test(v)).map(([k, v]) => `light --${k}: ${v}`),
  ];
  expect(bad).toEqual([]);
});

it('every var(--chart-*) referenced by chart code or the Tailwind config is defined', () => {
  const missing = referencedTokens().filter(r => !(r.token in dark)).map(r => `${r.file}: --${r.token}`);
  expect(missing).toEqual([]);
});
