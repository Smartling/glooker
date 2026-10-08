/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-ownership-card.test.tsx
// The ownership card shell: tabs, the name filter and the fixed 330px body. The tables have their own
// files (vuln-team-table, vuln-repo-table).
import { fireEvent, render, screen, within } from '@testing-library/react';
import OwnershipCard, { OWN_TAB_COUNT_MIN_W } from '@/app/vulnerabilities/ownership-card';
import { OWNERSHIP_BODY_H } from '@/app/vulnerabilities/dimensions';
import type { ReposData, SummaryData } from '@/app/vulnerabilities/api-types';
import { cell, ovCell, ovProps, ovTeam, repoRow, reposFixture, slot, summaryFixture } from '../support/security-fixtures';

const body = () => screen.getByTestId('ownership-card-body');

describe('the body keeps its height in every state', () => {
  const err = (label: string) => ({ error: new Error('x'), errorText: `Couldn't load ${label}: x`, loading: false });
  const branches: Array<[string, ReturnType<typeof ovProps>]> = [
    ['teams: populated', ovProps()],
    ['teams: unfiltered summary failed', ovProps({ teamSummary: slot<SummaryData>(undefined, err('team table')) })],
    ['teams: unfiltered summary still loading (falls back to the scoped one)', ovProps({ teamSummary: slot<SummaryData>(undefined, { loading: true }) })],
    ['teams: stale', ovProps({ teamSummary: slot(summaryFixture(), { stale: true }) })],
    ['repos: populated', ovProps({ url: { own: 'repos' } })],
    ['repos: loading', ovProps({ url: { own: 'repos' }, data: { repos: slot<ReposData>(undefined, { loading: true }) } })],
    ['repos: error', ovProps({ url: { own: 'repos' }, data: { repos: slot<ReposData>(undefined, err('repositories')) } })],
    ['repos: empty', ovProps({ url: { own: 'repos' }, repos: [] })],
  ];

  // Revert: apply the height only in the populated branch, or on the outer section.
  it.each(branches)('%s', (_name, props) => {
    render(<OwnershipCard {...props} />);
    expect(body().style.height).toBe(`${OWNERSHIP_BODY_H}px`);
    expect(screen.getByTestId('ownership-card').style.height).toBe('');
  });
});

describe('tabs', () => {
  it('presses the tab named by url.own and labels the body with it', () => {
    const { rerender } = render(<OwnershipCard {...ovProps()} />);
    expect(screen.getByRole('button', { name: /Owning teams/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Repositories/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('team-table')).toBeTruthy();
    expect(body().getAttribute('aria-labelledby')).toBe('ownership-tab-teams');
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getByRole('button', { name: /Repositories/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('repo-table')).toBeTruthy();
    expect(screen.queryByTestId('team-table')).toBeNull();
    expect(body().getAttribute('aria-labelledby')).toBe('ownership-tab-repos');
  });

  // Revert: write the view or the team instead of `own`.
  it('a tab click calls url.setOwn', () => {
    const p = ovProps();
    render(<OwnershipCard {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Repositories/ }));
    expect(p.url.setOwn).toHaveBeenCalledWith('repos');
    fireEvent.click(screen.getByRole('button', { name: /Owning teams/ }));
    expect(p.url.setOwn).toHaveBeenLastCalledWith('teams');
  });

  it('the tab labels carry the team count and "N + M unmeasured" for repositories', () => {
    render(<OwnershipCard {...ovProps()} />);
    expect(screen.getByRole('button', { name: /Owning teams/ }).textContent).toBe('Owning teams2');
    expect(screen.getByRole('button', { name: /Repositories/ }).textContent).toBe('Repositories3 + 1 unmeasured');
  });

  it('the repositories count has no unmeasured part when none is unmeasured, and no count before the rows load', () => {
    const { unmount } = render(<OwnershipCard {...ovProps({ repos: [repoRow('acme/a', 'Payments')] })} />);
    expect(screen.getByRole('button', { name: /Repositories/ }).textContent).toBe('Repositories1');
    unmount();
    render(<OwnershipCard {...ovProps({ data: { repos: slot<ReposData>(undefined, { loading: true }) } })} />);
    expect(screen.getByRole('button', { name: /Repositories/ }).textContent).toBe('Repositories');
  });

  // Revert: render a count only when it has a value, or without the min-width: the Repositories tab slides
  // when the team count gains a digit.
  it('each tab count sits in a slot with a minimum width, in every state, so the tab after it does not move', () => {
    const states = [
      ovProps(),
      ovProps({ repos: [repoRow('acme/a', 'Payments')] }),
      ovProps({ data: { repos: slot<ReposData>(undefined, { loading: true }) } }),
    ];
    for (const p of states) {
      const { unmount } = render(<OwnershipCard {...p} />);
      for (const id of ['teams', 'repos']) {
        expect(screen.getByTestId(`ownership-tab-count-${id}`).style.minWidth).toBe(OWN_TAB_COUNT_MIN_W);
      }
      unmount();
    }
  });

  // Revert: drop the data-label / after: classes: the pressed tab is wider (semibold) and the other tab slides when you switch.
  it('each tab label reserves its semibold width, pressed or not, so switching tabs moves nothing', () => {
    for (const own of ['teams', 'repos'] as const) {
      const { unmount } = render(<OwnershipCard {...ovProps({ url: { own } })} />);
      for (const [id, label] of [['teams', 'Owning teams'], ['repos', 'Repositories']]) {
        const el = screen.getByTestId(`ownership-tab-label-${id}`);
        expect(el.getAttribute('data-label')).toBe(label);
        expect(el.className).toContain('after:font-semibold');
        expect(el.className).toContain('after:content-[attr(data-label)]');
      }
      unmount();
    }
  });

  it('explains what a click does on each tab', () => {
    const { rerender } = render(<OwnershipCard {...ovProps()} />);
    expect(screen.getByText('Click a team to filter the page to it')).toBeTruthy();
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getByText('Click a repository to open its alerts')).toBeTruthy();
  });

  // Revert: drop the overflow suffix, or add it to the Repositories tab's hint.
  it('appends "· scroll for more" to the Owning teams hint only when the team rows overflow the body', () => {
    const teams = (n: number) => Array.from({ length: n }, (_, i) => ovTeam(`Team ${i + 1}`, ovCell(1), ovCell(0)));
    const summary = (n: number) => ({ pivot: { rows: teams(n), total: ovTeam('Total', ovCell(n), ovCell(0)) } });
    const { rerender } = render(<OwnershipCard {...ovProps({ summary: summary(4) })} />);
    expect(screen.getByText('Click a team to filter the page to it')).toBeTruthy();
    expect(screen.queryByText(/scroll for more/)).toBeNull();
    rerender(<OwnershipCard {...ovProps({ summary: summary(14) })} />);
    expect(screen.getByText('Click a team to filter the page to it · scroll for more')).toBeTruthy();
    // The Repositories hint never says it: that table has its own header and footer and no such hint.
    rerender(<OwnershipCard {...ovProps({ summary: summary(14), url: { own: 'repos' } })} />);
    expect(screen.queryByText(/scroll for more/)).toBeNull();
  });
});

describe('interactions through the card', () => {
  // Revert: toggle the team in the card, or call setTeam.
  it('a team row click calls url.selectTeamRow', () => {
    const p = ovProps();
    render(<OwnershipCard {...p} />);
    fireEvent.click(screen.getByTestId('team-row-Payments'));
    expect(p.url.selectTeamRow).toHaveBeenCalledWith('Payments');
  });

  it('a repository row click calls url.selectRepoRow with the repository and its team', () => {
    const p = ovProps({ url: { own: 'repos' } });
    render(<OwnershipCard {...p} />);
    fireEvent.click(screen.getByTestId('repo-row-acme/checkout-api'));
    expect(p.url.selectRepoRow).toHaveBeenCalledWith({ fullName: 'acme/checkout-api', team: 'Payments' });
  });

  // Revert: leave the unmeasured row's stored count out of the footer sum (it then reads 6 where the team row reads 10).
  it('a team with an unmeasured repository that still holds stored alerts reads the same open counts in its team row and in the Repositories footer', () => {
    const rows = [
      repoRow('acme/a', 'Payments', { critical: cell({ open: 6 }), high: cell({ open: 2 }) }),
      repoRow('acme/legacy', 'Payments', { critical: cell({ open: 4 }), high: cell({ open: 1 }), unmeasured: { status: 'error', detail: null } }),
    ];
    const pivot = { rows: [ovTeam('Payments', ovCell(10), ovCell(3), 1)], total: ovTeam('Total', ovCell(10), ovCell(3), 1) };
    const props = (own: 'teams' | 'repos') => ovProps({ summary: { pivot }, repos: rows, url: { team: 'Payments', own } });
    const cells = (id: string) => Array.from(screen.getByTestId(id).querySelectorAll('[role="cell"]')).map(c => c.textContent);
    const { rerender } = render(<OwnershipCard {...props('teams')} />);
    const teamRow = cells('team-row-Payments');
    rerender(<OwnershipCard {...props('repos')} />);
    const footer = cells('repo-footer');
    // team row: [team, open crit, change, resolved, % closed, overdue crit, open high, ...]; footer: [label, open crit, overdue crit, open high, ...]
    expect([teamRow[1], teamRow[6]]).toEqual(['10', '3']);
    expect([footer[1], footer[3]]).toEqual(['10', '3']);
  });

  // Revert: build the team table from the scoped summary.
  it('with a team selected the team table still lists every team (it reads the unfiltered summary)', () => {
    const scoped = { pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1))], total: ovTeam('Total', ovCell(3), ovCell(1)) } };
    const everyone = summaryFixture({ pivot: { rows: [ovTeam('Payments', ovCell(3), ovCell(1)), ovTeam('Search', ovCell(7), ovCell(2))], total: ovTeam('Total', ovCell(10), ovCell(3)) } });
    render(<OwnershipCard {...ovProps({ summary: scoped, url: { team: 'Payments' }, teamSummary: slot(everyone) })} />);
    expect(screen.getByTestId('team-row-Search')).toBeTruthy();
    expect(screen.getByTestId('team-row-Payments').className).toContain('bg-accent/10');
  });

  it('with a team selected the Repositories tab lists that team\'s rows from the scoped repos response', () => {
    const rows = [repoRow('acme/checkout-api', 'Payments', { critical: cell({ open: 2 }) })];
    const p = ovProps({ url: { own: 'repos', team: 'Payments' }, repos: rows });
    p.data.repos = slot(reposFixture(rows, { codebase: 'backend', team: 'Payments' }));
    render(<OwnershipCard {...p} />);
    expect(screen.getAllByTestId(/^repo-row-/)).toHaveLength(1);
    expect(screen.getByTestId('repo-footer').textContent).toContain('Payments total · 1 repo');
  });
});

describe('name filter', () => {
  it('exists only on the Repositories tab', () => {
    const { rerender } = render(<OwnershipCard {...ovProps()} />);
    expect(screen.queryByLabelText('Filter repositories by name')).toBeNull();
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getByLabelText('Filter repositories by name')).toBeTruthy();
  });

  // Revert: forget to pass the filter to the table, or leave the footer on "Total".
  it('narrows the rows by name and the footer reads "Matching"', () => {
    render(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect(screen.getAllByTestId(/^repo-row-/)).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Filter repositories by name'), { target: { value: 'ledger' } });
    expect(screen.getAllByTestId(/^repo-row-/)).toHaveLength(1);
    expect(within(screen.getByTestId('repo-footer')).getByText(/Matching · 1 repo/)).toBeTruthy();
  });

  it('keeps its text when the tab is switched away and back', () => {
    const { rerender } = render(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    fireEvent.change(screen.getByLabelText('Filter repositories by name'), { target: { value: 'ledger' } });
    rerender(<OwnershipCard {...ovProps()} />);
    rerender(<OwnershipCard {...ovProps({ url: { own: 'repos' } })} />);
    expect((screen.getByLabelText('Filter repositories by name') as HTMLInputElement).value).toBe('ledger');
  });
});
