/**
 * @jest-environment jsdom
 */
import { mergeEnrichment } from '@/lib/chat/context/enrich';
import type { PageContext } from '@/lib/chat/context/types';

const base: PageContext = {
  kind: 'developer-report',
  label: 'Developer · @junky',
  params: { reportId: 'abc123', login: 'junky' },
  source: 'route',
};

describe('mergeEnrichment', () => {
  it('returns the base unchanged when there is no enrichment', () => {
    expect(mergeEnrichment(base, null)).toEqual(base);
  });

  it('adds key figures and flips source to enriched', () => {
    const out = mergeEnrichment(base, {
      keyFigures: [{ label: 'Spend', value: '$48.30' }],
    });
    expect(out.keyFigures).toEqual([{ label: 'Spend', value: '$48.30' }]);
    expect(out.source).toBe('enriched');
  });

  it('lets a page override the label', () => {
    expect(mergeEnrichment(base, { label: 'Junky — 14 days' }).label).toBe('Junky — 14 days');
  });

  it('merges filters rather than replacing them', () => {
    const withFilters = { ...base, filters: { team: 'Integrations' } };
    const out = mergeEnrichment(withFilters, { filters: { sort: 'impact' } });
    expect(out.filters).toEqual({ team: 'Integrations', sort: 'impact' });
  });

  it('cannot change kind or params', () => {
    const out = mergeEnrichment(base, { kind: 'evil', params: { reportId: 'other' } } as any);
    expect(out.kind).toBe('developer-report');
    expect(out.params).toEqual({ reportId: 'abc123', login: 'junky' });
  });

  it('does not flip source to enriched when only a label is supplied', () => {
    expect(mergeEnrichment(base, { label: 'x' }).source).toBe('route');
  });
});
