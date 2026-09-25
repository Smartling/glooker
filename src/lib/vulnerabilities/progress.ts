/**
 * In-process progress store for vulnerability syncs (GLOOK-43 follow-up). Mirrors
 * `src/lib/progress-store.ts`'s API and conventions (globalThis Map to survive Next.js HMR, ET
 * timestamps on log lines, a 200-line cap) but is deliberately its own module, not a reuse of
 * progress-store.ts — that store's type is report-specific, and the vulnerability module is
 * standalone (no coupling to reports/schedules, see the root CLAUDE.md).
 *
 * PURE store, no db import: the syncs tab imports `SyncProgress` as a type-only import, so this
 * file must never pull in a DB driver that would leak into the browser bundle (see the comment at
 * the top of vulnerability-syncs-tab.tsx).
 */

export interface SyncProgress {
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  step:   string;
  done:   number;   // units finished in the current counted step (0 when the step has no count)
  total:  number;   // units in the current counted step (0 when unknown)
  logs:   string[];
}

const globalStore = globalThis as typeof globalThis & {
  __glooker_vuln_sync_progress?: Map<number, SyncProgress>;
};

if (!globalStore.__glooker_vuln_sync_progress) {
  globalStore.__glooker_vuln_sync_progress = new Map();
}

const store = globalStore.__glooker_vuln_sync_progress;

/** Only one sync runs at a time, so every OTHER entry is deleted first — the map never grows. */
export function initSyncProgress(id: number): void {
  store.clear();
  store.set(id, { status: 'running', step: 'Starting…', done: 0, total: 0, logs: [] });
}

export function updateSyncProgress(id: number, patch: Partial<SyncProgress>): void {
  const current = store.get(id);
  if (current) store.set(id, { ...current, ...patch });
}

export function addSyncLog(id: number, message: string): void {
  const current = store.get(id);
  if (current) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' });
    current.logs.push(`[${ts}] ${message}`);
    if (current.logs.length > 200) current.logs.splice(0, current.logs.length - 200);
  }
}

export function getSyncProgress(id: number): SyncProgress | null {
  return store.get(id) || null;
}
