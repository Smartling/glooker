/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-strip.test.tsx
// The Alerts view's 72px summary strip. Its figures come from the `repos` rows for the current
// scope, never from the alert list's response, and its SLA tail follows sla-state.ts.
import { render, screen, fireEvent } from '@testing-library/react';
import AlertsStrip, { ALERTS_STRIP_OPEN_MIN_W, ALERTS_STRIP_OVERDUE_MIN_W, ALERTS_STRIP_TITLE_W } from '@/app/vulnerabilities/alerts-strip';
import { ALERTS_STRIP_H } from '@/app/vulnerabilities/dimensions';
import { unmeasuredBadgeText } from '@/app/vulnerabilities/labels';
import { REFRESH_FAILED_NOTE, UNAVAILABLE_TEXT } from '@/app/vulnerabilities/slot-view';
import {
  viewProps, slot, reposFixture, alertsFixture, repoRow, cell, REPO_ROWS, AL_RAIL_ROWS, alSummary, type AlSlaKind,
} from '../support/security-fixtures';

// Dates print through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates read the same every year.
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });

const bothActive = alSummary({ critical: 'active', high: 'active' });
const text = (id: string) => screen.getByTestId(id).textContent;

/** Props with the given repos rows, scope and SLA states. */
function props(opts: {
  rows?: Parameters<typeof reposFixture>[0]; urlOver?: Record<string, unknown>; effectiveRepo?: string | null;
  summary?: ReturnType<typeof alSummary>; data?: Record<string, unknown>;
} = {}) {
  const base = viewProps({ summary: opts.summary ?? bothActive });
  return {
    ...base,
    url: { ...base.url, ...(opts.urlOver ?? {}) },
    data: {
      ...base.data,
      repos: slot(reposFixture(opts.rows ?? AL_RAIL_ROWS)),
      effectiveRepo: opts.effectiveRepo ?? null,
      ...(opts.data ?? {}),
    },
  } as ReturnType<typeof viewProps>;
}

describe('figures', () => {
  it('CRIT and HIGH read "N open · N overdue", summed over every repos row, an unmeasured row\'s stored count included', () => {
    render(<AlertsStrip {...props()} />);
    // critical open: 5+3+2+2+2+0 + 7 (invoice-render, unmeasured) + 4 (legacy-batch, unmeasured) = 25
    expect(text('strip-critical-open')).toBe('25');
    // high open: 0+2+5+5+1+0 + 0 + 1 = 14
    expect(text('strip-high-open')).toBe('14');
    // overdue: critical 1 (checkout) + 1 (billing) + 2 (invoice-render); high 3 (checkout)
    expect(text('strip-critical-tail')).toContain('4 overdue');
    expect(text('strip-high-tail')).toContain('3 overdue');
  });

  it('reads the repos rows, not the alert list response: a different list total changes nothing', () => {
    const p = props();
    const withList = { ...p, data: { ...p.data, alerts: slot(alertsFixture([], 999)) } } as typeof p;
    render(<AlertsStrip {...withList} />);
    expect(text('strip-critical-open')).toBe('25');
    expect(text('strip-high-open')).toBe('14');
    expect(screen.getByTestId('alerts-strip').textContent).not.toContain('999');
  });

  it('a selected repository narrows every figure to that row', () => {
    render(<AlertsStrip {...props({ effectiveRepo: 'acme/checkout-api', urlOver: { repo: 'acme/checkout-api' } })} />);
    expect(text('strip-critical-open')).toBe('3');
    expect(text('strip-high-open')).toBe('2');
    expect(text('strip-critical-tail')).toContain('1 overdue');
    expect(text('strip-high-tail')).toContain('3 overdue');
  });

  it('a repository that was not found is not the scope: the figures stay at the whole scope', () => {
    // url.repo is still set, but data.effectiveRepo is null (repoStatus "not-found").
    render(<AlertsStrip {...props({ effectiveRepo: null, urlOver: { repo: 'acme/missing' }, data: { repoStatus: 'not-found' } })} />);
    expect(text('strip-critical-open')).toBe('25');
    expect(text('strip-title')).toBe('All repositories');
  });

  it('shows a dash for the counts while the repos rows are loading, and keeps the badge slot', () => {
    render(<AlertsStrip {...props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined) } })} />);
    expect(text('strip-critical-open')).toBe('—');
    expect(text('strip-high-open')).toBe('—');
    expect(screen.getByTestId('alerts-strip').style.height).toBe(`${ALERTS_STRIP_H}px`);
  });
});

describe('scope label and title', () => {
  it('no team: "All owning teams" over "All repositories"', () => {
    render(<AlertsStrip {...props()} />);
    expect(text('strip-kind')).toBe('All owning teams');
    expect(text('strip-title')).toBe('All repositories');
  });

  it('a team: "Owning team" over "<team> · all repositories"', () => {
    render(<AlertsStrip {...props({ urlOver: { team: 'Payments' } })} />);
    expect(text('strip-kind')).toBe('Owning team');
    expect(text('strip-title')).toBe('Payments · all repositories');
  });

  it('a repository: "Repository · owning team <team>" over the repository name', () => {
    render(<AlertsStrip {...props({ effectiveRepo: 'acme/audit-log', urlOver: { repo: 'acme/audit-log' } })} />);
    expect(text('strip-kind')).toBe('Repository · owning team Platform');
    expect(text('strip-title')).toBe('acme/audit-log');
  });
});

describe('the SLA tail, per state, for each severity (strip consumer of sla-state)', () => {
  const cases: Array<[AlSlaKind, string]> = [
    ['active', '4 overdue'],
    ['pending', 'SLA starts Feb 1, 2099'],
    ['none', 'no SLA policy yet'],
    ['invalid', "SLA policy can't be read"],
  ];

  it.each(cases)('critical %s reads "%s" while high stays active', (kind, tail) => {
    const states = { critical: kind, high: kind === 'invalid' ? 'invalid' : 'active' } as const;
    render(<AlertsStrip {...props({ summary: alSummary(states) })} />);
    const el = screen.getByTestId('strip-critical-tail');
    expect(el.textContent).toContain(tail);
    // An overdue count is shown only while that severity's SLA is active.
    if (kind !== 'active') expect(el.textContent).not.toMatch(/overdue/);
    // The state message is red and bold for an unreadable policy only.
    expect(el.className.includes('text-red-400')).toBe(kind === 'invalid' || kind === 'active');
  });

  it.each(cases.filter(([k]) => k !== 'invalid'))('high %s reads "%s" while critical stays active', (kind, _tail) => {
    render(<AlertsStrip {...props({ summary: alSummary({ critical: 'active', high: kind }) })} />);
    const el = screen.getByTestId('strip-high-tail');
    const expected = { active: '3 overdue', pending: 'SLA starts Feb 1, 2099', none: 'no SLA policy yet' }[kind as 'active' | 'pending' | 'none'];
    expect(el.textContent).toContain(expected);
    if (kind !== 'active') expect(el.textContent).not.toMatch(/overdue/);
  });

  it('an unreadable policy shows the "!" icon and reads as red, never as "no SLA policy yet"', () => {
    render(<AlertsStrip {...props({ summary: alSummary({ critical: 'invalid', high: 'invalid' }) })} />);
    for (const sev of ['critical', 'high']) {
      const el = screen.getByTestId(`strip-${sev}-tail`);
      expect(el.textContent).toContain("SLA policy can't be read");
      expect(el.textContent).not.toMatch(/no SLA policy yet/i);
      expect(el.textContent).toContain('!');
      expect(el.className).toContain('font-bold');
    }
  });

  it('an active SLA with nothing overdue reads "0 overdue" in grey, not red', () => {
    render(<AlertsStrip {...props({ rows: REPO_ROWS.filter(r => r.fullName === 'acme/search-index'), summary: alSummary({ critical: 'active', high: 'none' }) })} />);
    const el = screen.getByTestId('strip-critical-tail');
    expect(el.textContent).toContain('0 overdue');
    expect(el.className).not.toContain('text-red-400');
  });
});

describe('hidden severity', () => {
  it.each([
    ['critical', 'strip-high', 'strip-critical'],
    ['high', 'strip-critical', 'strip-high'],
  ])('Severity "%s only" dims %s to 0.35 and keeps its figures; %s stays at 1', (severity, dimmed, shown) => {
    render(<AlertsStrip {...props({ urlOver: { severity } })} />);
    expect(screen.getByTestId(dimmed).style.opacity).toBe('0.35');
    expect(screen.getByTestId(shown).style.opacity).toBe('1');
    expect(screen.getByTestId(`${dimmed}-open`).textContent).not.toBe('—');
  });

  it('"Critical + high" dims neither row', () => {
    render(<AlertsStrip {...props()} />);
    expect(screen.getByTestId('strip-critical').style.opacity).toBe('1');
    expect(screen.getByTestId('strip-high').style.opacity).toBe('1');
  });
});

describe('unmeasured badge', () => {
  it('shows the one badge phrase "▲ N unmeasured repos" when no repository is selected, and clicking it opens the drawer from that element', () => {
    const p = props();
    render(<AlertsStrip {...p} />);
    const badge = screen.getByTestId('strip-unmeasured');
    expect(badge.textContent).toBe(unmeasuredBadgeText(2));
    expect(badge.textContent).toBe('▲ 2 unmeasured repos');
    fireEvent.click(badge);
    expect(p.openDrawer).toHaveBeenCalledWith(badge);
  });

  it('is singular for one repository', () => {
    render(<AlertsStrip {...props({ rows: [...REPO_ROWS] })} />);
    expect(text('strip-unmeasured')).toBe('▲ 1 unmeasured repo');
  });

  it('is absent when a repository is selected, and absent when nothing is unmeasured', () => {
    const { unmount } = render(<AlertsStrip {...props({ effectiveRepo: 'acme/audit-log', urlOver: { repo: 'acme/audit-log' } })} />);
    expect(screen.queryByTestId('strip-unmeasured')).toBeNull();
    unmount();
    render(<AlertsStrip {...props({ rows: [repoRow('acme/ledger', 'Payments', { critical: cell({ open: 1 }) })] })} />);
    expect(screen.queryByTestId('strip-unmeasured')).toBeNull();
  });
});

describe('fixed title column', () => {
  const noRows = slot<ReturnType<typeof reposFixture>>(undefined);
  // Revert: size the column by its content (min-width instead of width): the CRIT and HIGH blocks slide
  // sideways as the title changes between "All repositories", a team and a repository.
  it.each([
    ['all repositories', props(), 'All repositories'],
    ['a team', props({ urlOver: { team: 'Payments' } }), 'Payments · all repositories'],
    ['a repository', props({ effectiveRepo: 'acme/audit-log', urlOver: { repo: 'acme/audit-log' } }), 'acme/audit-log'],
    ['loading', props({ data: { repos: noRows } }), 'All repositories'],
  ])('%s: the title column is ALERTS_STRIP_TITLE_W wide and does not shrink, and a long title is cut with its full text in the title attribute', (_label, p, title) => {
    render(<AlertsStrip {...p} />);
    const col = screen.getByTestId('strip-title-col');
    expect(col.style.width).toBe(`${ALERTS_STRIP_TITLE_W}px`);
    expect(col.className).toContain('shrink-0');
    expect(col.className).not.toMatch(/min-w-/);
    const t = screen.getByTestId('strip-title');
    expect(t.className).toContain('truncate');
    expect(t.getAttribute('title')).toBe(title);
  });
});

describe('figure slots and unclipped SLA labels', () => {
  // Revert: let the open figure size to its digits (the HIGH block slides when the CRIT count gains a digit), or left-align it in its
  // slot (a gap opens between the figure and "open", so "54 open · 53 overdue" stops reading as one phrase).
  it.each([
    ['25 open · 4 overdue', props()],
    ['one repository, one digit', props({ effectiveRepo: 'acme/checkout-api', urlOver: { repo: 'acme/checkout-api' } })],
    ['loading dashes', props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined) } })],
    ['a severity hidden by the filter', props({ urlOver: { severity: 'high' } })],
  ])('%s: each open figure is right-aligned in a slot with a minimum width, so "open" and the tail follow it directly', (_label, p) => {
    render(<AlertsStrip {...p} />);
    for (const sev of ['critical', 'high']) {
      const slotEl = screen.getByTestId(`strip-${sev}-open-slot`);
      expect(slotEl.style.minWidth).toBe(`${ALERTS_STRIP_OPEN_MIN_W}px`);
      expect(slotEl.className).toContain('text-right');
      // "open" follows the slot with one space, and nothing sits between the figure and it.
      expect(slotEl.parentElement!.textContent).toMatch(/^\S+ open$/);
    }
  });

  // Revert: drop the tail's minWidth while the SLA is active: the HIGH block slides when "overdue" gains a digit.
  it('while the SLA is active each overdue figure has a minimum width, and no state label gets one', () => {
    render(<AlertsStrip {...props()} />);
    for (const sev of ['critical', 'high']) {
      expect(screen.getByTestId(`strip-${sev}-tail`).style.minWidth).toBe(`${ALERTS_STRIP_OVERDUE_MIN_W}px`);
    }
  });

  // Revert: give a severity block a fixed width (or `shrink-0` with a width): "no SLA policy yet", "SLA starts {date}" and
  // "SLA policy can't be read" are longer than the figures and would be cut. The blocks size to their content.
  it.each([
    ['pending', { critical: 'pending', high: 'pending' }, /SLA starts /],
    ['none', { critical: 'none', high: 'none' }, /no SLA policy yet/],
    ['invalid', { critical: 'invalid', high: 'invalid' }, /SLA policy can't be read/],
  ] as Array<[string, { critical: AlSlaKind; high: AlSlaKind }, RegExp]>)('%s: the label is whole, has no minimum width, and no severity block has a fixed width', (_name, kinds, label) => {
    render(<AlertsStrip {...props({ summary: alSummary(kinds) })} />);
    for (const sev of ['critical', 'high']) {
      const block = screen.getByTestId(`strip-${sev}`);
      expect(block.style.width).toBe('');
      expect(block.className).not.toContain('shrink-0');
      expect(screen.getByTestId(`strip-${sev}-tail`).style.minWidth).toBe('');
      expect(screen.getByTestId(`strip-${sev}-tail`).textContent).toMatch(label);
    }
  });
});

describe('fixed height', () => {
  it.each([
    ['populated', props()],
    ['loading', props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined) } })],
    ['error', props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('boom'), errorText: "Couldn't load repositories: boom" }) } })],
    ['empty scope', props({ rows: [] })],
  ])('the %s strip is ALERTS_STRIP_H as an inline style', (_label, p) => {
    render(<AlertsStrip {...p} />);
    expect(screen.getByTestId('alerts-strip').style.height).toBe(`${ALERTS_STRIP_H}px`);
  });

  it('an error replaces the figures with the error text', () => {
    render(<AlertsStrip {...props({ data: { repos: slot<ReturnType<typeof reposFixture>>(undefined, { loading: false, error: new Error('boom'), errorText: "Couldn't load repositories: boom" }) } })} />);
    expect(screen.getByTestId('alerts-strip').textContent).toContain("Couldn't load repositories: boom");
    expect(screen.queryByTestId('strip-critical-open')).toBeNull();
  });
});

// The slot-view rule (slot-view.ts): the strip's own rows win over everything. These cases are not in the plan's
// brief; the brief's "error with no rows" case above is the rule's third row and is unchanged.
describe('slot-view rule', () => {
  type Rows = ReturnType<typeof reposFixture>;
  const withSlot = (s: ReturnType<typeof slot<Rows>>) => props({ data: { repos: s } });

  // Revert: decide "error vs figures" with `errorText && !rows` against a slot that is stale (or: drop the dim).
  it('a stale slot (the previous key\'s rows while a new key loads) keeps its figures, dimmed to 0.6, with no note', () => {
    render(<AlertsStrip {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { stale: true, loading: false }))} />);
    expect(text('strip-critical-open')).toBe('25');
    expect(screen.getByTestId('strip-figures').style.opacity).toBe('0.6');
    expect(screen.queryByTestId('strip-refresh-note')).toBeNull();
  });

  it('a fresh slot is not dimmed', () => {
    render(<AlertsStrip {...props()} />);
    expect(screen.getByTestId('strip-figures').style.opacity).toBe('1');
  });

  // Revert: the brief's `errorText && !rows` read shows the figures but drops the note; reading `errorText` first drops the figures.
  it('a same-key refresh that failed keeps the rows and adds "Couldn\'t refresh · showing last load"', () => {
    render(<AlertsStrip {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { errorText: "Couldn't load repositories: boom", error: new Error('boom') }))} />);
    expect(text('strip-critical-open')).toBe('25');
    expect(text('strip-high-open')).toBe('14');
    expect(text('strip-refresh-note')).toBe(REFRESH_FAILED_NOTE);
    expect(screen.getByTestId('strip-refresh-note').className).toContain('text-red-400');
    expect(screen.getByTestId('alerts-strip').textContent).not.toContain("Couldn't load repositories");
    expect(screen.getByTestId('alerts-strip').style.height).toBe(`${ALERTS_STRIP_H}px`);
  });

  // Revert: put the note next to the figures (or render the spacer only while the note shows): the strip's blocks move when it appears.
  it('the note lives in the strip\'s flexible spacer, which is there with or without it, so showing it moves nothing', () => {
    const { rerender } = render(<AlertsStrip {...props()} />);
    const spacer = screen.getByTestId('strip-note-slot');
    expect(spacer.className).toContain('flex-1');
    expect(spacer.children).toHaveLength(0);
    rerender(<AlertsStrip {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { errorText: 'x' }))} />);
    expect(screen.getByTestId('strip-note-slot')).toBe(spacer);
    expect(screen.getByTestId('strip-refresh-note').parentElement).toBe(spacer);
    // The blocks keep their order: title column, figures, spacer, badge.
    const order = Array.from(screen.getByTestId('alerts-strip').children).map(el => el.getAttribute('data-testid'));
    expect(order.filter(Boolean)).toEqual(['strip-title-col', 'strip-figures', 'strip-note-slot', 'strip-unmeasured']);
  });

  it('no rows and an unavailable answer: its short message in place of the figures, never "Loading…" or dashes', () => {
    const unavailable = { available: false as const, reason: 'No sync has run yet.' };
    render(<AlertsStrip {...withSlot(slot<Rows>(undefined, { unavailable, loading: false }))} />);
    const el = screen.getByTestId('strip-unavailable');
    expect(el.textContent).toBe(UNAVAILABLE_TEXT);
    expect(el.getAttribute('title')).toBe('No sync has run yet.');
    expect(screen.queryByTestId('strip-critical-open')).toBeNull();
    expect(screen.getByTestId('alerts-strip').style.height).toBe(`${ALERTS_STRIP_H}px`);
  });

  it('own rows beat an unavailable flag left on the slot', () => {
    const unavailable = { available: false as const, reason: 'old' };
    render(<AlertsStrip {...withSlot(slot(reposFixture(AL_RAIL_ROWS), { unavailable }))} />);
    expect(text('strip-critical-open')).toBe('25');
    expect(screen.queryByTestId('strip-unavailable')).toBeNull();
  });
});
