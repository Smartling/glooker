'use client';
// GLOOK-64: the alert list's pager (spec "Columns and sorting", Pager). Presentational: the page
// number lives in the alert-list controller, this only draws it and reports a click.

/** The pager row's fixed height in px. The alert list's column chrome adds it up, so it is a constant. */
export const PAGER_H = 28;
export const PAGER_NOTE = 'counted per Dependabot alert, not per CVE';

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** How many pages `totalCount` alerts make; an empty result still has one (empty) page. */
export const pageCount = (totalCount: number, pageSize: number) => Math.max(1, Math.ceil(totalCount / pageSize));

/** "1–10 of 26 alerts · counted per Dependabot alert, not per CVE". With nothing to count it reads "0 alerts · ...". */
export function pagerText(page: number, pageSize: number, totalCount: number): string {
  if (totalCount === 0) return `0 alerts · ${PAGER_NOTE}`;
  const from = Math.min((Math.max(1, page) - 1) * pageSize + 1, totalCount);
  const to = Math.min(totalCount, from + pageSize - 1);
  return `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${plural(totalCount, 'alert')} · ${PAGER_NOTE}`;
}

export interface PagerProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** null while the count is not known (loading, error): the row keeps its height and reads nothing. */
  totalCount: number | null;
  onPage: (page: number) => void;
}

const buttonClass = 'h-7 px-2.5 rounded-md bg-chart-surface text-xs whitespace-nowrap disabled:opacity-40 disabled:cursor-default';

export default function Pager({ page, pageSize, totalCount, onPage }: PagerProps) {
  const known = totalCount !== null;
  const pages = known ? pageCount(totalCount, pageSize) : 1;
  // While the page number is ahead of a shrunken result, the display never reads "Page 4 of 3".
  const shown = Math.min(Math.max(1, page), pages);
  return (
    <div
      data-testid="alert-pager"
      className="box-border flex items-center justify-between gap-3 text-xs text-gray-400"
      style={{ height: PAGER_H }}
    >
      <span className="min-w-0 truncate" aria-hidden={known ? undefined : true}>
        {known ? pagerText(page, pageSize, totalCount) : '\u00a0'}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className={`${buttonClass} text-gray-300`} disabled={!known || shown <= 1} onClick={() => onPage(shown - 1)}>
          ‹ Previous
        </button>
        <span className="px-1.5 whitespace-nowrap" aria-hidden={known ? undefined : true}>{known ? `Page ${shown} of ${pages}` : '\u00a0'}</span>
        <button type="button" className={`${buttonClass} text-gray-300`} disabled={!known || shown >= pages} onClick={() => onPage(shown + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}
