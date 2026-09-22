'use client';

import useSWR from 'swr';
import ChatPanel from './chat-panel';

/**
 * Auto-resolving wrapper around ChatPanel for pages that have no report (and
 * therefore no org) in scope. Resolves the org the same way `page.tsx` does —
 * from the latest completed report — so those pages don't need to hardcode an
 * org string. Renders nothing until the org is known.
 *
 * Being a client component, it can be rendered directly from a server
 * component page (e.g. projects, profile) with no other wrapper needed.
 */
export default function ChatPanelAuto() {
  const { data: config } = useSWR('/api/llm-config', { revalidateIfStale: false });
  const org = config?.latestReport?.org ?? null;

  return org ? <ChatPanel org={org} /> : null;
}
