'use client';

import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { buildFromRoute, findEntry } from './registry';
import { mergeEnrichment, useEnrichmentStore } from './enrich';
import type { PageContext } from './types';

/**
 * Tiers 1 + 2. Returns null on a registry miss so the caller may fall through
 * to tier 3, which is the only tier that costs anything.
 */
export function usePageContext(): PageContext | null {
  const pathname = usePathname() ?? '/';
  const params = useParams() as Record<string, string | string[]>;
  const search = useSearchParams();
  const { enrichment } = useEnrichmentStore();

  const base = buildFromRoute(pathname, params, new URLSearchParams(search?.toString() ?? ''));
  if (!base) return null;
  return mergeEnrichment(base, enrichment);
}

/** Suggested questions for the current view; empty array on a miss. */
export function usePageSuggestions(): string[] {
  const pathname = usePathname() ?? '/';
  const params = useParams() as Record<string, string | string[]>;
  return findEntry(pathname, params)?.suggestions ?? [];
}
