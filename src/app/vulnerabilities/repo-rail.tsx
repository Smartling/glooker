// src/app/vulnerabilities/repo-rail.tsx
'use client';
import type { SecurityViewProps } from './view-props';
import { RAIL_W } from './dimensions';

/** Slot for the repository rail. The card's grid gives it its 260px column. */
export default function RepoRail(_props: SecurityViewProps) {
  return <aside aria-label="Repositories" data-testid="repo-rail" style={{ width: RAIL_W }} />;
}
