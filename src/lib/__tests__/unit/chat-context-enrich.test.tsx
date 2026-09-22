/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import {
  mergeEnrichment,
  PageContextProvider,
  useEnrichmentStore,
  useEnrichPageContext,
} from '@/lib/chat/context/enrich';
import type { Enrichment } from '@/lib/chat/context/enrich';
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

/** Renders the current raw enrichment (pre-merge) as text for assertions. */
function Display() {
  const { enrichment } = useEnrichmentStore();
  return <div data-testid="enrichment">{JSON.stringify(enrichment)}</div>;
}

/** One enrichment consumer, with a stable identity via `key` in the tests
 * below so removing it from the tree actually unmounts this instance rather
 * than reusing its fiber with new props. */
function Consumer({ value }: { value: Enrichment | null }) {
  useEnrichPageContext(value);
  return null;
}

describe('useEnrichPageContext ownership tracking', () => {
  it('does not clear a still-current enrichment when a stale consumer unmounts', () => {
    const { rerender } = render(
      <PageContextProvider>
        <Consumer key="a" value={{ label: 'A' }} />
        <Consumer key="b" value={{ label: 'B' }} />
        <Display />
      </PageContextProvider>,
    );

    // B mounts after A, so B holds the slot.
    expect(screen.getByTestId('enrichment').textContent).toBe(JSON.stringify({ label: 'B' }));

    // Unmount the stale consumer (A). Its cleanup releases A's own token,
    // which is not the current owner, so B's enrichment must survive.
    rerender(
      <PageContextProvider>
        <Consumer key="b" value={{ label: 'B' }} />
        <Display />
      </PageContextProvider>,
    );

    expect(screen.getByTestId('enrichment').textContent).toBe(JSON.stringify({ label: 'B' }));
  });

  it('clears the enrichment when the current owner unmounts', () => {
    const { rerender } = render(
      <PageContextProvider>
        <Consumer key="a" value={{ label: 'A' }} />
        <Consumer key="b" value={{ label: 'B' }} />
        <Display />
      </PageContextProvider>,
    );

    expect(screen.getByTestId('enrichment').textContent).toBe(JSON.stringify({ label: 'B' }));

    // Unmount the current owner (B). Its release matches the current
    // owner token, so the slot must clear.
    rerender(
      <PageContextProvider>
        <Consumer key="a" value={{ label: 'A' }} />
        <Display />
      </PageContextProvider>,
    );

    expect(screen.getByTestId('enrichment').textContent).toBe(JSON.stringify(null));
  });
});
