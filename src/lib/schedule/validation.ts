import { Cron } from 'croner';

/** `kind` is the stored schedule's kind on update; a vuln_sync schedule has no org/period to validate. */
export function validateScheduleBody(body: any, kind: 'report' | 'vuln_sync' = 'report'): string | null {
  const { org, periodDays, cronExpr, timezone } = body;
  if (kind === 'report') {
    if (!org || typeof org !== 'string') return 'org is required';
    if (![3, 14, 30, 90].includes(Number(periodDays))) return 'periodDays must be 3, 14, 30, or 90';
  }
  if (!cronExpr || typeof cronExpr !== 'string') return 'cronExpr is required';
  if (!timezone || typeof timezone !== 'string') return 'timezone is required';

  try {
    const test = new Cron(cronExpr, { timezone });
    test.stop();
  } catch {
    return 'Invalid cron expression or timezone';
  }

  return null;
}
