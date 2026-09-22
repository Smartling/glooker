'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { KeyFigure, PageContext } from './types';

/** What a page may contribute. It cannot change kind or params. */
export interface Enrichment {
  label?: string;
  keyFigures?: KeyFigure[];
  filters?: Record<string, string>;
}

interface Store {
  enrichment: Enrichment | null;
  setEnrichment: (e: Enrichment | null) => void;
}

const EnrichmentContext = createContext<Store>({
  enrichment: null,
  setEnrichment: () => {},
});

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [enrichment, setEnrichment] = useState<Enrichment | null>(null);
  const value = useMemo(() => ({ enrichment, setEnrichment }), [enrichment]);
  return <EnrichmentContext.Provider value={value}>{children}</EnrichmentContext.Provider>;
}

/** Read the current enrichment. Used by usePageContext. */
export function useEnrichmentStore(): Store {
  return useContext(EnrichmentContext);
}

/**
 * A page declares the figures it considers essential. It already rendered them,
 * so this is exact and free — no model is needed to guess what matters.
 *
 * Serialise `partial` into the dependency list so a page can pass an object
 * literal without re-registering on every render.
 */
export function useEnrichPageContext(partial: Enrichment | null): void {
  const { setEnrichment } = useEnrichmentStore();
  const key = JSON.stringify(partial ?? null);
  useEffect(() => {
    setEnrichment(partial ?? null);
    return () => setEnrichment(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setEnrichment]);
}

/** Pure merge, exported for testing. Enrichment can never widen identity. */
export function mergeEnrichment(
  base: PageContext,
  partial: Enrichment | null,
): PageContext {
  if (!partial) return base;

  const out: PageContext = { ...base };
  if (partial.label) out.label = partial.label;

  if (partial.filters && Object.keys(partial.filters).length > 0) {
    out.filters = { ...(base.filters ?? {}), ...partial.filters };
  }

  if (partial.keyFigures && partial.keyFigures.length > 0) {
    out.keyFigures = partial.keyFigures;
    // Only a page-declared figure earns 'enriched', because that is what the
    // preamble trusts. A label change alone does not.
    out.source = 'enriched';
  }

  return out;
}
