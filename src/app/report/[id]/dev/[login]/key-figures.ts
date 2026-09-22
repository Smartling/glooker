import type { KeyFigure } from '@/lib/chat/context/types';

/** Minimal shape this needs from DevStats — kept separate from page.tsx's own
 *  interface so this module has no dependency on the page. */
export interface DevKeyFigureInput {
  cc_total_cost?: number | null;
  total_commits?: number | null;
  total_prs?: number | null;
}

/**
 * Build the chat chip's key figures for the developer page.
 *
 * Exported for tests: `stripCostFields` (cost-visibility.ts) *deletes*
 * cc_total_cost for viewers outside the developer's team — it is absent, not
 * zero. A spend figure must therefore only be emitted when the value is
 * actually present (`!= null`); coalescing an absent value to 0 would put a
 * fabricated "$0.00" into the model's system prompt, matching usage-card.tsx's
 * own `costCents != null` check for the same field.
 */
export function buildDevKeyFigures(dev: DevKeyFigureInput): KeyFigure[] {
  const figures: KeyFigure[] = [];

  if (dev.cc_total_cost != null) {
    figures.push({ label: 'Claude Code spend', value: `$${(Number(dev.cc_total_cost) / 100).toFixed(2)}` });
  }

  figures.push({ label: 'Commits', value: Number(dev.total_commits ?? 0) });
  figures.push({ label: 'PRs', value: Number(dev.total_prs ?? 0) });

  return figures;
}
