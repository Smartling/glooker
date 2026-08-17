'use client';

import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

/**
 * Shared SWR fetcher. Exported so every caller that hand-rolls a fetch into
 * SWR's cache (e.g. `preload` on the Projects board) produces errors that read
 * the same way as the ones SWR raises itself.
 *
 * On a non-ok response the thrown Error carries the API's own `error` string
 * when there is one. Route handlers answer with `{ error: '…' }`, and throwing
 * only the status code turned "No Jira projects configured. Add one in
 * Settings → Projects." — the normal first-run state of a fresh deployment —
 * into a bare "Error: 404" for the user.
 */
export const jsonFetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) {
    let message = `${r.status}`;
    try {
      const body = await r.json();
      const apiError = (body as { error?: unknown } | null)?.error;
      if (typeof apiError === 'string' && apiError.trim() !== '') message = apiError;
    } catch {
      // Non-JSON body (an HTML error page, an empty 502) — the status code is
      // all we have, and it is better than throwing a parse error over the
      // real failure.
    }
    throw new Error(message);
  }
  return r.json();
};

export default function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{
      fetcher: jsonFetcher,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000,
      errorRetryCount: 1,
    }}>
      {children}
    </SWRConfig>
  );
}
