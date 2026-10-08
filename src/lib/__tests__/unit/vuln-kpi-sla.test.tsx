/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-kpi-sla.test.tsx
// The KPI tile "SLA · open alerts": Overdue and Due ≤ 7d per severity while that policy is active,
// otherwise the state's own message. The wording comes from sla-state.ts, so it matches every other consumer.
import { fireEvent, render, screen, within } from '@testing-library/react';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import type { SummaryData } from '@/app/vulnerabilities/api-types';
import { KPI_PAD_X, KPI_PAD_Y, KPI_SLA_ROW_H } from '@/app/vulnerabilities/dimensions';
import { ovCell, ovProps, ovTeam } from '../support/security-fixtures';

type Status = 'active' | 'pending' | 'none';
// The page prints dates through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates below read the same every year.
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });
const row = (sev: 'critical' | 'high') => screen.getByTestId(`kpi-sla-${sev}`);
const policyRow = (severity: 'critical' | 'high', pending: boolean, effectiveFrom: string) =>
  ({ id: `${severity}-${effectiveFrom}`, severity, days: 7, effectiveFrom, until: null, pending });

/** A summary whose two severities are in the given states, with figures in the active ones. */
function sla(critical: Status, high: Status, over: Partial<SummaryData> = {}): Partial<SummaryData> {
  return {
    slaStatus: { critical, high },
    policy: [
      ...(critical === 'none' ? [] : [policyRow('critical', critical === 'pending', critical === 'pending' ? '2099-02-01' : '2020-01-08')]),
      ...(high === 'none' ? [] : [policyRow('high', high === 'pending', high === 'pending' ? '2099-02-01' : '2020-01-08')]),
    ],
    pivot: { rows: [], total: ovTeam('Total', ovCell(20, { overdue: 15, dueSoon: 2 }), ovCell(30, { overdue: 13, dueSoon: 4 })) },
    ...over,
  };
}

describe('active policy', () => {
  it('shows Overdue and Due ≤ 7d for each severity, overdue in red', () => {
    render(<KpiTiles {...ovProps({ summary: sla('active', 'active') })} />);
    expect(within(row('critical')).getByText('15').className).toContain('text-red-400');
    expect(within(row('critical')).getByText('2')).toBeTruthy();
    expect(within(row('high')).getByText('13')).toBeTruthy();
    expect(within(row('high')).getByText('4')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Due ≤ 7d')).toBeTruthy();
  });

  // Revert: colour a zero overdue red.
  it('a zero overdue count is not red', () => {
    const p = ovProps({ summary: sla('active', 'active', { pivot: { rows: [], total: ovTeam('Total', ovCell(5, { overdue: 0, dueSoon: 1 }), ovCell(5, { overdue: 0, dueSoon: 0 })) } }) });
    render(<KpiTiles {...p} />);
    expect(within(row('critical')).getAllByText('0').length).toBe(1);
    expect(within(row('critical')).getByText('0').className).not.toContain('text-red-400');
  });
});

describe.each([['critical', 'high'], ['high', 'critical']] as const)('%s row in a non-active state while %s stays active', (sev, other) => {
  const statuses = (s: Status) => (sev === 'critical' ? sla(s, 'active') : sla('active', s));

  // Revert: render the Overdue / Due cells for a pending policy.
  it('pending: "Starts <display date>" spanning both columns, grey, and no figures', () => {
    render(<KpiTiles {...ovProps({ summary: statuses('pending') })} />);
    const state = screen.getByTestId(`kpi-sla-${sev}-state`);
    expect(state.textContent).toBe('Starts Feb 1, 2099');
    expect(state.className).toContain('col-span-2');
    expect(state.className).not.toContain('text-red-400');
    // the row's OWN figures (critical 15 overdue / 2 due soon, high 13 / 4) are gone; the other severity's are still there
    for (const own of sev === 'critical' ? ['15', '2'] : ['13', '4']) expect(within(row(sev)).queryByText(own)).toBeNull();
    for (const theirs of other === 'critical' ? ['15', '2'] : ['13', '4']) expect(within(row(other)).getByText(theirs)).toBeTruthy();
  });

  it('none: "No SLA policy yet", never the invalid message', () => {
    render(<KpiTiles {...ovProps({ summary: statuses('none') })} />);
    expect(screen.getByTestId(`kpi-sla-${sev}-state`).textContent).toBe('No SLA policy yet');
    expect(screen.queryByText('Policy error')).toBeNull();
  });

  // Revert: check slaStatus before slaPolicyInvalid (an invalid policy then reads as merely empty).
  it('invalid: "!" icon and "Policy error" in red, with the full sentence in its title, never "No SLA policy yet"', () => {
    render(<KpiTiles {...ovProps({ summary: { ...statuses('none'), slaPolicyInvalid: true } })} />);
    const invalid = screen.getByTestId(`kpi-sla-${sev}-state`);
    expect(invalid.textContent).toBe('!Policy error');
    expect(invalid.className).toContain('text-red-400');
    expect(invalid.getAttribute('title')).toMatch(/^SLA policy can't be read/);
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });
});

describe('state wording and tone', () => {
  // Revert: let slaStatus win over slaPolicyInvalid.
  it('an invalid policy reads as an error on BOTH rows (it parses to an empty policy, so slaStatus says none)', () => {
    render(<KpiTiles {...ovProps({ summary: { ...sla('none', 'none'), slaPolicyInvalid: true } })} />);
    for (const sev of ['critical', 'high'] as const) {
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).textContent).toContain('Policy error');
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).className).toContain('text-red-400');
    }
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });

  it('an empty policy reads "No SLA policy yet" on both rows, in grey', () => {
    render(<KpiTiles {...ovProps({ summary: sla('none', 'none') })} />);
    for (const sev of ['critical', 'high'] as const) {
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).textContent).toBe('No SLA policy yet');
      expect(screen.getByTestId(`kpi-sla-${sev}-state`).className).toContain('text-gray-400');
    }
  });

  it('every non-active state carries an explanation in its title', () => {
    render(<KpiTiles {...ovProps({ summary: sla('pending', 'none') })} />);
    expect(screen.getByTestId('kpi-sla-critical-state').getAttribute('title')).toMatch(/not started yet/);
    expect(screen.getByTestId('kpi-sla-high-state').getAttribute('title')).toMatch(/No SLA policy is configured/);
  });
});

describe('hidden severity', () => {
  // Revert: dim by something other than the Severity filter, or drop the dimming.
  it('keeps the row of a severity the filter hides and dims it to 35%', () => {
    const { rerender } = render(<KpiTiles {...ovProps({ summary: sla('active', 'active'), url: { severity: 'critical', kSev: 'critical' } })} />);
    expect(row('high').className).toContain('opacity-[0.35]');
    expect(row('critical').className).not.toContain('opacity-[0.35]');
    expect(within(row('high')).getByText('13')).toBeTruthy();
    rerender(<KpiTiles {...ovProps({ summary: sla('active', 'active'), url: { severity: 'high', kSev: 'high' } })} />);
    expect(row('critical').className).toContain('opacity-[0.35]');
    expect(row('high').className).not.toContain('opacity-[0.35]');
    rerender(<KpiTiles {...ovProps({ summary: sla('active', 'active') })} />);
    expect(row('critical').className).not.toContain('opacity-[0.35]');
    expect(row('high').className).not.toContain('opacity-[0.35]');
  });
});

describe('shape', () => {
  // Revert: put `h-7` (28px) back on the rows, or use `items-center` on the header row: the pitch is not the mockup's, and the 24px button pushes the title down off the other tiles' line.
  it('each severity row is KPI_SLA_ROW_H tall, and the title sits on the tile\'s top line (items-start) beside the 24px button', () => {
    render(<KpiTiles {...ovProps({ summary: sla('active', 'active') })} />);
    for (const sev of ['critical', 'high'] as const) {
      expect(row(sev).style.height).toBe(`${KPI_SLA_ROW_H}px`);
      expect(row(sev).className).not.toContain('h-7');
    }
    const header = screen.getByText('SLA · open alerts').parentElement as HTMLElement;
    expect(header.className).toContain('items-start');
    expect(header.className).not.toContain('items-center');
    expect(screen.getByTestId('kpi-sla').style.padding).toBe(`${KPI_PAD_Y}px ${KPI_PAD_X}px`);
  });

  // Revert: give one tile's padding (or the open / resolved tile) its old `p-4`: its label then sits 2px higher than the others'.
  it('every tile has the same padding, so the four titles share one line', () => {
    render(<KpiTiles {...ovProps()} />);
    for (const id of ['kpi-open', 'kpi-since', 'kpi-resolved', 'kpi-sla']) expect(screen.getByTestId(id).style.padding).toBe(`${KPI_PAD_Y}px ${KPI_PAD_X}px`);
  });
});

describe('the info button', () => {
  // Revert: back to h-5 w-5 (20px, under the 24px minimum target size).
  it('is a 24 x 24 target', () => {
    render(<KpiTiles {...ovProps()} />);
    const button = screen.getByRole('button', { name: 'Coverage and policy details' });
    expect(button.className).toContain('h-6');
    expect(button.className).toContain('w-6');
    expect(button.className).not.toMatch(/\b(h-5|w-5)\b/);
  });

  // Revert: call openDrawer() with no argument (focus would not return to the button on close).
  it('opens the coverage and policy drawer, passing the button so focus can return to it', () => {
    const p = ovProps();
    render(<KpiTiles {...p} />);
    const button = screen.getByRole('button', { name: 'Coverage and policy details' });
    fireEvent.click(button);
    expect(p.openDrawer).toHaveBeenCalledTimes(1);
    expect(p.openDrawer).toHaveBeenCalledWith(button);
  });
});
