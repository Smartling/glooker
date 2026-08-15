import { visibleTabs, columnLayout, computeSpans } from '@/app/projects/board-layout';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';

const cfg = (over: Partial<typeof DEFAULT_BOARD_CONFIG> = {}) => ({ ...DEFAULT_BOARD_CONFIG, ...over });

describe('visibleTabs', () => {
  it('shows Rollout for the default board', () => {
    expect(visibleTabs(null)).toEqual(['In Progress', 'Rollout', 'Done']);
  });

  it('shows Rollout when a config leaves middleTab alone', () => {
    expect(visibleTabs(cfg())).toEqual(['In Progress', 'Rollout', 'Done']);
  });

  it('swaps in Backlog when configured', () => {
    expect(visibleTabs(cfg({ middleTab: 'Backlog' }))).toEqual(['In Progress', 'Backlog', 'Done']);
  });
});

describe('columnLayout', () => {
  it('gives the default board seven columns summing to 100%', () => {
    const layout = columnLayout(null);
    expect(layout.headers).toEqual(['Business Goal', 'Initiative', '', 'Epic', 'Due', 'Lead', 'Team']);
    expect(layout.widths).toHaveLength(7);
    expect(layout.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(layout.showHierarchy).toBe(true);
    expect(layout.showOwnerColumn).toBe(false);
  });

  it('gives owner mode six columns summing to 100%, with Researcher first and Status split out', () => {
    const layout = columnLayout(cfg({ hierarchy: 'owner' }));
    expect(layout.headers).toEqual(['Researcher', '', 'Epic', 'Due', 'Status', 'Team']);
    expect(layout.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(layout.showHierarchy).toBe(false);
    expect(layout.showOwnerColumn).toBe(true);
  });

  it('keeps the ring column at 4% in both layouts', () => {
    expect(columnLayout(null).widths[2]).toBe(4);
    expect(columnLayout(cfg({ hierarchy: 'owner' })).widths[1]).toBe(4);
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
