'use client';

import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
});

export default function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{
      fetcher,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 60_000,
      errorRetryCount: 1,
    }}>
      {children}
    </SWRConfig>
  );
}
