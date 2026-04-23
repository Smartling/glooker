// Claude Code spend CSV filenames embed the period as
// ...YYYY-MM-DD-to-YYYY-MM-DD... (e.g. spend-report-<uuid>-2026-04-01-to-2026-04-21.csv).
// Used by both the upload API route (server) and the Settings upload UI (client).

export const SPEND_PERIOD_FILENAME_REGEX = /(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})/;

export function parseSpendPeriodFromFilename(filename: string): { start: string; end: string } | null {
  const m = filename.match(SPEND_PERIOD_FILENAME_REGEX);
  if (!m) return null;
  return { start: m[1], end: m[2] };
}
