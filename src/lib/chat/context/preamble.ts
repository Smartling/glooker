import type { PageContext } from './types';

/** Hard cap so one page cannot blow the preamble budget. */
const MAX_FIGURES = 8;

/**
 * Render the descriptor as a short system-prompt block.
 *
 * Key figures are emitted ONLY when source === 'enriched', i.e. a page
 * explicitly declared them. A route-derived or model-inferred context must
 * never put values into the prompt — every number the agent states has to come
 * back through its tools, which run under the caller's identity and therefore
 * respect cost-visibility.
 */
export function buildPreamble(ctx: PageContext | null | undefined): string {
  if (!ctx) return '';

  const lines: string[] = ['', '## What the user is currently viewing', ''];
  lines.push(`View: ${ctx.label} (${ctx.kind})`);

  const params = Object.entries(ctx.params).map(([k, v]) => `${k}=${v}`);
  if (params.length) lines.push(`Identifiers: ${params.join(', ')}`);

  const filters = Object.entries(ctx.filters ?? {}).map(([k, v]) => `${k}=${v}`);
  if (filters.length) lines.push(`Active filters: ${filters.join(', ')}`);

  if (ctx.source === 'enriched' && ctx.keyFigures?.length) {
    const figures = ctx.keyFigures
      .slice(0, MAX_FIGURES)
      .map(f => `${f.label}: ${f.value}`)
      .join('; ');
    lines.push(`On screen: ${figures}`);
  }

  if (ctx.source === 'inferred') {
    lines.push('Note: this view was inferred from the page and is unverified. Say so if you rely on it.');
  }

  lines.push(
    '',
    'Resolve vague references ("this developer", "here", "my spend") against this view.',
    'Always confirm figures with your tools; never restate a number without fetching it.',
  );

  return lines.join('\n');
}
