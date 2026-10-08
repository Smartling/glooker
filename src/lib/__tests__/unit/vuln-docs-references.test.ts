// GLOOK-64: docs/vulnerabilities-page.md names files and tests; a name that no longer exists, or a
// retired module that creeps back in, makes the document lie to the next reader. This reads the
// document, so it fails the day a file is renamed or deleted without the document being updated.
import fs from 'fs';
import path from 'path';
import { KNOWN_VULN_ENV_VARS } from '@/lib/vulnerabilities/config';
import {
  ALERTS_CARD_H, ALERTS_STRIP_H, ALERT_LIST_H, ALERT_ROW_H, COVERAGE_LINE_MIN_H, DRAWER_W, FILTER_BAR_H,
  KPI_ROW_H, OWNERSHIP_BODY_H, PAGE_MAX_W, RAIL_W, RESET_SLOT_W, SELECT_W, SPARK_H, TEAM_ROW_H, TREND_PLOT_H,
} from '@/app/vulnerabilities/dimensions';

const root = path.join(__dirname, '../../../..');
const doc = fs.readFileSync(path.join(root, 'docs/vulnerabilities-page.md'), 'utf8');
const ticked = [...new Set([...doc.matchAll(/`([^`\n]+)`/g)].map(m => m[1]))];

const RETIRED = ['alerts-table', 'AlertsTable', 'AlertsPanel', 'team-pivot', 'TeamPivot', 'trend-chart', 'TrendChart', 'coverage-panel', 'CoveragePanel', 'policy-panel', 'PolicyPanel'];

it('every src/, scripts/ and docs/ path the document names exists', () => {
  const paths = ticked.filter(t => /^(src|scripts|docs)\/[\w./[\]-]+\.(ts|tsx|md|css|json|sql)$/.test(t));
  expect(paths.filter(p => !fs.existsSync(path.join(root, p)))).toEqual([]);
  expect(paths.length).toBeGreaterThan(40); // the extractor really found the Key files table and the prose
});

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(root, path.join(dir, e.name))]));
const sourceFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))];

it('every bare module name in the Key files and Page modules tables exists somewhere under src/ or scripts/', () => {
  const bare = ticked.filter(t => /^[\w./[\]-]+\.(ts|tsx)$/.test(t) && !/^(src|scripts|docs)\//.test(t) && !/\.test\.tsx?$/.test(t));
  expect(bare.filter(b => !sourceFiles.some(f => f === b || f.endsWith('/' + b)))).toEqual([]);
  expect(bare.length).toBeGreaterThan(20);
});

it('every VULN_* / VULNERABILITIES_* variable the document names is read by config.ts, and every one config.ts reads is documented', () => {
  const CODE_CONSTANTS = ['VULN_COMMON', 'VULN_GITHUB_TIMEOUT_MS']; // named in the document, but constants, not env vars
  const named = ticked.filter(t => /^VULN(ERABILITIES)?_[A-Z_]+$/.test(t) && !CODE_CONSTANTS.includes(t));
  expect(named.filter(v => !KNOWN_VULN_ENV_VARS.has(v))).toEqual([]);
  expect([...KNOWN_VULN_ENV_VARS].filter(v => !named.includes(v))).toEqual([]);
});

it('every test file the document names exists', () => {
  const tests = ticked.filter(t => /^[\w-]+\.test\.tsx?$/.test(t));
  expect(tests.filter(t => !fs.existsSync(path.join(root, 'src/lib/__tests__/unit', t)))).toEqual([]);
  expect(tests.length).toBeGreaterThan(10);
});

it('does not mention a module the redesign retired', () => {
  expect(RETIRED.filter(name => doc.includes(name))).toEqual([]);
});

it('the Layout stability section states the sizes dimensions.ts defines', () => {
  const start = doc.indexOf('## Layout stability');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
  expect(start).toBeGreaterThan(-1);
  const sizes = {
    PAGE_MAX_W, COVERAGE_LINE_MIN_H, FILTER_BAR_H, KPI_ROW_H, OWNERSHIP_BODY_H, SPARK_H, TREND_PLOT_H,
    ALERTS_STRIP_H, ALERTS_CARD_H, ALERT_LIST_H, ALERT_ROW_H, RAIL_W, DRAWER_W, TEAM_ROW_H, RESET_SLOT_W, SELECT_W_DATE: SELECT_W.date,
  };
  // A size must stand alone: "280px" must not be satisfied by "1280px", nor "1.5px" by "5px".
  const states = (px: number) => new RegExp(`(?<![\\d.])${px}px`).test(section);
  expect(Object.entries(sizes).filter(([, px]) => !states(px)).map(([name]) => name)).toEqual([]);
});
