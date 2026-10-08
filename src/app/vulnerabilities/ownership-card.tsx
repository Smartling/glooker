// src/app/vulnerabilities/ownership-card.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { OWNERSHIP_BODY_H } from './dimensions';

/** Slot for the ownership card (Owning teams and Repositories tabs). Reserves the 330px body; the tabs sit above it. */
export default function OwnershipCard(_props: SecurityViewProps) {
  return (
    <section aria-label="Ownership" data-testid="ownership-card">
      <div data-testid="ownership-card-body" style={{ height: OWNERSHIP_BODY_H }} />
    </section>
  );
}
