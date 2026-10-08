// GLOOK-64: docs/vulnerabilities-page.md names files and tests; a name that no longer exists, or a
// retired module that creeps back in, makes the document lie to the next reader. This reads the
// document, so it fails the day a file is renamed or deleted without the document being updated.
import fs from 'fs';
import path from 'path';
import { KNOWN_VULN_ENV_VARS } from '@/lib/vulnerabilities/config';
import {
  ALERTS_CARD_H, ALERTS_STRIP_H, ALERTS_TAB_COUNT_W, ALERT_LIST_H, ALERT_ROW_H, COVERAGE_BADGE_SLOT_W, COVERAGE_EXCLUDED_SLOT_W,
  COVERAGE_LINE_MIN_H, COVERAGE_TAGGING_SLOT_W, DRAWER_W, FILTER_BAR_H, KPI_ROW_H, OWNERSHIP_BODY_H, PAGER_INDICATOR_W, PAGE_MAX_W,
  POLICY_LABEL_W, RAIL_FOOT_MIN_H, RAIL_W, RESET_SLOT_W, SELECT_W, SPARK_H, TEAM_FOOTNOTE_H, TEAM_HEAD_H, TEAM_ROW_H, TREND_PLOT_H,
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
// Root-level files (schema.sql, CLAUDE.md) are named bare too, so they count alongside src/, scripts/ and docs/.
const rootFiles = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
const sourceFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts')), ...walk(path.join(root, 'docs')), ...rootFiles];

it('every bare module name in the Key files and Page modules tables exists somewhere under src/ or scripts/', () => {
  const bare = ticked.filter(t => /^[\w./[\]-]+\.(ts|tsx|css|sql|md)$/.test(t) && !/^(src|scripts|docs)\//.test(t) && !/\.test\.tsx?$/.test(t));
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

it('the Layout stability table states each size dimensions.ts defines, in the row that owns it', () => {
  const start = doc.indexOf('## Layout stability');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
  expect(start).toBeGreaterThan(-1);
  // Each row is [constant, its value, the table row (by its first cell) that must state it]. Checking the row, not the section,
  // keeps a size like 24px (the page gap AND the sparkline) or 56px (a team header AND an alert row) from being satisfied by the wrong place.
  const sizes: Array<[string, number, string]> = [
    ['PAGE_MAX_W', PAGE_MAX_W, 'Page container'],
    ['COVERAGE_LINE_MIN_H', COVERAGE_LINE_MIN_H, 'Header coverage line'],
    ['COVERAGE_BADGE_SLOT_W', COVERAGE_BADGE_SLOT_W, 'Header coverage line'],
    ['COVERAGE_EXCLUDED_SLOT_W', COVERAGE_EXCLUDED_SLOT_W, 'Header coverage line'],
    ['COVERAGE_TAGGING_SLOT_W', COVERAGE_TAGGING_SLOT_W, 'Header coverage line'],
    ['FILTER_BAR_H', FILTER_BAR_H, 'Sticky bar'],
    ['SELECT_W.date', SELECT_W.date, 'Bar reserved slots'],
    ['RESET_SLOT_W', RESET_SLOT_W, 'Bar reserved slots'],
    ['ALERTS_TAB_COUNT_W', ALERTS_TAB_COUNT_W, 'Bar reserved slots'],
    ['KPI_ROW_H', KPI_ROW_H, 'KPI tile row'],
    ['OWNERSHIP_BODY_H', OWNERSHIP_BODY_H, 'Ownership card body'],
    ['TEAM_ROW_H', TEAM_ROW_H, 'Ownership card body'],
    ['TEAM_HEAD_H', TEAM_HEAD_H, 'Ownership card body'],
    ['TEAM_FOOTNOTE_H', TEAM_FOOTNOTE_H, 'Ownership card body'],
    ['SPARK_H', SPARK_H, 'Sparkline slot'],
    ['TREND_PLOT_H', TREND_PLOT_H, 'Trend plot'],
    ['ALERTS_STRIP_H', ALERTS_STRIP_H, 'Alerts summary strip'],
    ['ALERTS_CARD_H', ALERTS_CARD_H, 'Alerts card'],
    ['RAIL_W', RAIL_W, 'Repository rail'],
    ['RAIL_FOOT_MIN_H', RAIL_FOOT_MIN_H, 'Repository rail'],
    ['ALERT_LIST_H', ALERT_LIST_H, 'Alert list'],
    ['ALERT_ROW_H', ALERT_ROW_H, 'Alert list'],
    ['PAGER_INDICATOR_W', PAGER_INDICATOR_W, 'Alert list'],
    ['DRAWER_W', DRAWER_W, 'Drawer'],
    ['POLICY_LABEL_W', POLICY_LABEL_W, 'Drawer'],
  ];
  const rows = new Map(section.split('\n').filter(l => l.startsWith('|')).map(l => [l.split('|')[1].trim(), l] as const));
  // A size must stand alone: "280px" must not be satisfied by "1280px", nor "1.5px" by "5px".
  const states = (row: string | undefined, px: number) => !!row && new RegExp(`(?<![\\d.])${px}px`).test(row);
  expect(sizes.filter(([, px, row]) => !states(rows.get(row), px)).map(([name]) => name)).toEqual([]);
});
