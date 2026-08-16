import { visibleTabs, tabLabel, columnLayout, computeSpans } from '@/app/projects/board-layout';
import type { JiraProject } from '@/lib/jira-projects/types';

const SPS: JiraProject = {
  id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0,
};
const RND: JiraProject = { ...SPS, id: 'b', projectKey: 'RND', middleStatus: 'Backlog', hierarchy: 'owner' };

describe('visibleTabs', () => {
  it('gives a three-tab board when the project has a middle status', () => {
    expect(visibleTabs(SPS)).toEqual(['active', 'middle', 'done']);
  });

  it('gives a two-tab board when it does not', () => {
    expect(visibleTabs({ ...SPS, middleStatus: null })).toEqual(['active', 'done']);
  });

  it('falls back to a two-tab board with no project', () => {
    expect(visibleTabs(null)).toEqual(['active', 'done']);
  });
});

describe('tabLabel', () => {
  it('labels the active and middle tabs with the project status names', () => {
    expect(tabLabel(SPS, 'active')).toBe('In Progress');
    expect(tabLabel(SPS, 'middle')).toBe('Rollout');
    expect(tabLabel(RND, 'middle')).toBe('Backlog');
  });

  it('labels done with the fixed window', () => {
    expect(tabLabel(SPS, 'done')).toBe('Done (30d)');
  });

  it('is safe with no project', () => {
    expect(tabLabel(null, 'active')).toBe('In Progress');
  });
});

describe('columnLayout', () => {
  it('gives seven columns for goal-initiative, summing to 100', () => {
    const l = columnLayout(SPS);
    expect(l.headers).toEqual(['Business Goal', 'Initiative', '', 'Epic', 'Due', 'Lead', 'Team']);
    expect(l.widths).toHaveLength(l.headers.length);
    expect(l.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(l.showHierarchy).toBe(true);
    expect(l.showOwnerColumn).toBe(false);
  });

  it('gives six columns for owner, summing to 100', () => {
    const l = columnLayout(RND);
    expect(l.headers).toEqual(['Owner', '', 'Epic', 'Due', 'Status', 'Team']);
    expect(l.widths).toHaveLength(l.headers.length);
    expect(l.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(l.showHierarchy).toBe(false);
    expect(l.showOwnerColumn).toBe(true);
  });

  it('defaults to the seven-column layout with no project', () => {
    expect(columnLayout(null).headers).toHaveLength(7);
  });
});

type Row = { key: string; assignee: string | null; goal: { summary: string } | null; initiative: { summary: string } | null };

const epic = (key: string, assignee: string | null, goal?: string, init?: string): Row => ({
  key,
  assignee,
  goal: goal ? { summary: goal } : null,
  initiative: init ? { summary: init } : null,
});

describe('computeSpans in goal-initiative mode', () => {
  it('merges consecutive rows sharing a goal and initiative', () => {
    const rows = [
      epic('A', null, 'G1', 'I1'),
      epic('B', null, 'G1', 'I1'),
      epic('C', null, 'G1', 'I2'),
    ];
    const spans = computeSpans(rows, 'goal-initiative');

    expect(spans[0].showPrimary).toBe(true);
    expect(spans[0].primarySpan).toBe(3);   // all three share G1
    expect(spans[0].showSecondary).toBe(true);
    expect(spans[0].secondarySpan).toBe(2); // A and B share I1
    expect(spans[1].showPrimary).toBe(false);
    expect(spans[2].showSecondary).toBe(true);
    expect(spans[2].secondarySpan).toBe(1);
  });

  it('treats a null goal as its own group rather than crashing', () => {
    const spans = computeSpans([epic('A', null), epic('B', null)], 'goal-initiative');
    expect(spans[0].primarySpan).toBe(2);
    expect(spans[1].showPrimary).toBe(false);
  });
});

describe('computeSpans in owner mode', () => {
  it('merges consecutive rows sharing an assignee', () => {
    const rows = [
      epic('A', 'Daria Akselrod'),
      epic('B', 'Daria Akselrod'),
      epic('C', 'Attila Jamilov'),
    ];
    const spans = computeSpans(rows, 'owner');

    expect(spans[0].showPrimary).toBe(true);
    expect(spans[0].primarySpan).toBe(2);
    expect(spans[1].showPrimary).toBe(false);
    expect(spans[2].showPrimary).toBe(true);
    expect(spans[2].primarySpan).toBe(1);
  });

  it('groups unassigned rows together', () => {
    const spans = computeSpans([epic('A', null), epic('B', null)], 'owner');
    expect(spans[0].primarySpan).toBe(2);
  });

  it('never emits a secondary span, since owner mode has no second merged column', () => {
    const spans = computeSpans([epic('A', 'X'), epic('B', 'X')], 'owner');
    expect(spans.every(s => s.showSecondary === false)).toBe(true);
  });

  it('returns one span entry per row', () => {
    const rows = [epic('A', 'X'), epic('B', 'Y'), epic('C', 'Y')];
    expect(computeSpans(rows, 'owner')).toHaveLength(3);
  });

  it('handles an empty list', () => {
    expect(computeSpans([], 'owner')).toEqual([]);
  });
});
