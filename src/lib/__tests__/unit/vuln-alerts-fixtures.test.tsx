/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alerts-fixtures.test.tsx
// The Alerts-view fixtures (the `al` names in support/security-fixtures.ts) are pinned here, so a
// slot test that leans on one cannot pass against a fixture that quietly stopped meaning what its
// name says.
import { slaState, anySlaActive } from '@/app/vulnerabilities/sla-state';
import { addDays, diffDays } from '@/lib/vulnerabilities/time';
import {
  alSummary, AL_RAIL_ROWS, alAlertRow, alAlertRows, AL_OVERDUE_ROW, AL_RESOLVED_ROW, alAlertsRoute, type AlSlaKind,
} from '../support/security-fixtures';

describe('alSummary', () => {
  const kinds: AlSlaKind[] = ['active', 'pending', 'none'];

  it.each(kinds.flatMap(c => kinds.map(h => [c, h] as const)))('critical %s, high %s reads back through slaState', (critical, high) => {
    const s = alSummary({ critical, high });
    expect(slaState('critical', s).kind).toBe(critical);
    expect(slaState('high', s).kind).toBe(high);
    expect(anySlaActive(s)).toBe(critical === 'active' || high === 'active');
  });

  it('a pending severity starts on 2099-02-01', () => {
    expect(slaState('critical', alSummary({ critical: 'pending', high: 'active' }))).toEqual({ kind: 'pending', startsOn: '2099-02-01' });
  });

  it('an invalid state makes both severities invalid and leaves the policy empty, as a real unreadable policy does', () => {
    const s = alSummary({ critical: 'active', high: 'invalid' });
    expect(s.slaPolicyInvalid).toBe(true);
    expect(s.policy).toEqual([]);
    expect(slaState('critical', s).kind).toBe('invalid');
    expect(slaState('high', s).kind).toBe('invalid');
    expect(anySlaActive(s)).toBe(false);
  });

  it('other summary fields can be overridden', () => {
    expect(alSummary({ critical: 'active', high: 'active' }, { org: 'other' }).org).toBe('other');
  });
});

describe('AL_RAIL_ROWS', () => {
  it('is in server order: measured rows by open critical, then open high, then name; unmeasured rows last', () => {
    const measured = AL_RAIL_ROWS.filter(r => !r.unmeasured);
    const sorted = [...measured].sort((a, b) =>
      b.critical.open - a.critical.open || b.high.open - a.high.open || a.fullName.localeCompare(b.fullName));
    expect(measured.map(r => r.fullName)).toEqual(sorted.map(r => r.fullName));
    expect(AL_RAIL_ROWS.slice(measured.length).every(r => r.unmeasured)).toBe(true);
  });

  // Revert: reorder the two unmeasured rows: the rail's by-name tail and the server order would then be told apart by nothing.
  it('pins the unmeasured tail: invoice-render, then legacy-batch (the rail sorts that tail by name)', () => {
    const tail = AL_RAIL_ROWS.filter(r => r.unmeasured).map(r => r.fullName);
    expect(tail).toEqual(['acme/invoice-render', 'acme/legacy-batch']);
    expect(tail).toEqual([...tail].sort((a, b) => a.localeCompare(b)));
  });

  it('every active cell with an alert still to fall due has a next due date, and the others have none', () => {
    for (const r of AL_RAIL_ROWS) {
      for (const c of [r.critical, r.high]) {
        expect(c.nextDue !== null).toBe(c.open > (c.overdue ?? 0));
        if (c.nextDue) expect(c.nextDue.daysRemaining).toBe(diffDays(c.nextDue.date, '2026-09-30'));
      }
    }
  });

  it('puts the repository with the most overdue alerts below one with more open critical, so a rail re-sort is observable', () => {
    const overdue = (r: (typeof AL_RAIL_ROWS)[number]) => (r.critical.overdue ?? 0) + (r.high.overdue ?? 0);
    const measured = AL_RAIL_ROWS.filter(r => !r.unmeasured);
    const mostOverdue = measured.reduce((a, b) => (overdue(b) > overdue(a) ? b : a));
    expect(mostOverdue.fullName).toBe('acme/checkout-api');
    expect(measured[0].fullName).not.toBe(mostOverdue.fullName);
  });

  it('has a zero-alert repository and two unmeasured ones that still carry stored counts', () => {
    expect(AL_RAIL_ROWS.some(r => !r.unmeasured && r.critical.open + r.high.open === 0)).toBe(true);
    const unmeasured = AL_RAIL_ROWS.filter(r => r.unmeasured);
    expect(unmeasured.map(r => r.unmeasured!.status).sort()).toEqual(['dependabot-off', 'error']);
    expect(unmeasured.every(r => r.critical.open > 0)).toBe(true);
  });
});

describe('alert row fixtures', () => {
  it('alAlertRows makes n distinct alerts', () => {
    const rows = alAlertRows(12);
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map(r => r.cveId)).size).toBe(12);
    expect(new Set(rows.map(r => r.htmlUrl)).size).toBe(12);
    expect(alAlertRow(3, { severity: 'high' }).severity).toBe('high');
  });

  // The rows are read on 2026-09-30 (the clock the Alerts tests pin) under alSummary's 7-day critical policy.
  const TODAY = '2026-09-30';
  const day = (iso: string) => iso.slice(0, 10);

  // Revert: change a date in AL_OVERDUE_ROW without the ones it derives from.
  it('AL_OVERDUE_ROW\'s dates agree: created when the clock started, due 7 days later, 71 days gone, 78 days old', () => {
    const r = AL_OVERDUE_ROW;
    expect(day(r.clockStart!)).toBe(day(r.createdAt));
    expect(r.dueDate).toBe(addDays(day(r.clockStart!), 7));
    expect(r.daysRemaining).toBe(diffDays(r.dueDate!, TODAY));
    expect(r.ageDays).toBe(diffDays(TODAY, day(r.createdAt)));
  });

  it('AL_RESOLVED_ROW\'s dates agree: clock after creation and after the reopen, fixed before its due date, age counted to the fix', () => {
    const r = AL_RESOLVED_ROW;
    expect(r.clockStart! >= r.createdAt).toBe(true);
    expect(r.lastReopenedAt! >= r.createdAt && r.lastReopenedAt! < r.resolvedAt!).toBe(true);
    expect(r.dueDate).toBe(addDays(day(r.clockStart!), 7));
    expect(r.resolvedOnTime).toBe(true);
    expect(day(r.resolvedAt!) <= r.dueDate!).toBe(true);
    expect(r.ageDays).toBe(diffDays(day(r.resolvedAt!), day(r.createdAt)));
    expect(r.daysRemaining).toBeNull();
  });

  it('AL_OVERDUE_ROW is 71 days past due and AL_RESOLVED_ROW is a fixed alert that was reopened', () => {
    expect(AL_OVERDUE_ROW.daysRemaining).toBe(-71);
    expect(AL_OVERDUE_ROW.state).toBe('open');
    expect(AL_RESOLVED_ROW.state).toBe('fixed');
    expect(AL_RESOLVED_ROW.reopenedCount).toBe(1);
    expect(AL_RESOLVED_ROW.lastReopenedAt).toBe('2026-08-14T10:30:00Z');
  });
});

describe('alAlertsRoute', () => {
  const all = alAlertRows(26);
  const reply = (qs: string) => (alAlertsRoute(all)(new URL(`http://x/api/vulnerabilities/alerts?${qs}`)).body);

  it('serves one page of the list with the full total, and echoes limit and offset', () => {
    const body = reply('limit=10&offset=20');
    expect(body.rows.map(r => r.cveId)).toEqual(all.slice(20, 26).map(r => r.cveId));
    expect(body.totalCount).toBe(26);
    expect(body.appliedFilters).toMatchObject({ limit: 10, offset: 20, state: 'open', codebase: 'backend' });
  });

  it('an offset past the end is an empty page with the exact total', () => {
    const body = reply('limit=10&offset=40');
    expect(body.rows).toEqual([]);
    expect(body.totalCount).toBe(26);
  });

  it('echoes sort when one is sent and omits it otherwise', () => {
    expect(reply('limit=10&offset=0&sort=age:desc').appliedFilters).toMatchObject({ sort: 'age:desc' });
    expect(reply('limit=10&offset=0').appliedFilters).not.toHaveProperty('sort');
  });
});
