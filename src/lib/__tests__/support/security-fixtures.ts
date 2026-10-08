// src/lib/__tests__/support/security-fixtures.ts  (created here with two helpers; Task 2.5 extends it)
import type { RepoRow, RepoSevCell } from '@/lib/vulnerabilities/aggregate';

export const cell = (over: Partial<RepoSevCell> = {}): RepoSevCell => ({
  open: 0, overdue: null, dueSoon: null, oldestOpenDays: null, nextDue: null, ...over,
});

export const repoRow = (fullName: string, team: string, over: Partial<RepoRow> = {}): RepoRow => ({
  fullName, team, codebaseGroup: 'backend', critical: cell(), high: cell(), unmeasured: null, ...over,
});
