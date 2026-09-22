'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyFigure, PageContext } from './types';

/** What a page may contribute. It cannot change kind or params. */
export interface Enrichment {
  label?: string;
  keyFigures?: KeyFigure[];
  filters?: Record<string, string>;
}

/**
 * The store is a single last-write-wins slot with no ownership tracking
 * beyond this `owner` token. Without it, an unmounting consumer's cleanup
 * would unconditionally null out whatever a *different*, still-current
 * consumer had since claimed (two enrichers live at once — a nested layout
 * and a page, a modal over a page — or a mount/unmount pair straddling
 * separate commits during a route transition). The failure is silent: the
 * chip just loses its key figures with no error anywhere.
 */
interface EnrichmentState {
  owner: symbol | null;
  value: Enrichment | null;
}

interface Store {
  enrichment: Enrichment | null;
  claimEnrichment: (owner: symbol, value: Enrichment | null) => void;
  releaseEnrichment: (owner: symbol) => void;
}

const EnrichmentContext = createContext<Store>({
  enrichment: null,
  claimEnrichment: () => {},
  releaseEnrichment: () => {},
});

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EnrichmentState>({ owner: null, value: null });

  // Unconditional: the caller always wins the slot, regardless of who held it.
  const claimEnrichment = useCallback((owner: symbol, value: Enrichment | null) => {
    setState({ owner, value });
  }, []);

  // Conditional: clears only if `owner` is still the current holder. A stale
  // owner's release is a no-op — returning the same object so React skips
  // the re-render — because someone else has since claimed the slot.
  const releaseEnrichment = useCallback((owner: symbol) => {
    setState(prev => (prev.owner === owner ? { owner: null, value: null } : prev));
  }, []);

  const value = useMemo<Store>(
    () => ({ enrichment: state.value, claimEnrichment, releaseEnrichment }),
    [state.value, claimEnrichment, releaseEnrichment],
  );

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
 *
 * Each hook instance gets a stable `owner` token via `useRef` so its cleanup
 * only ever clears the slot it itself claimed — never a different, still-live
 * consumer's enrichment (see `EnrichmentState` above).
 */
export function useEnrichPageContext(partial: Enrichment | null): void {
  const { claimEnrichment, releaseEnrichment } = useEnrichmentStore();
  const ownerRef = useRef<symbol>(Symbol('page-context-enrichment'));
  const key = JSON.stringify(partial ?? null);
  useEffect(() => {
    claimEnrichment(ownerRef.current, partial ?? null);
    return () => releaseEnrichment(ownerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, claimEnrichment, releaseEnrichment]);
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
