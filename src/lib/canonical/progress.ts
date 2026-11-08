import { acquireRebuildLock, runRebuild, type CanonicalRebuildOrgResult } from './rebuild';
import { clearRangeCache } from '@/lib/report/range';

export interface RebuildProgress {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  currentOrg: string | null;
  orgsDone: number;
  orgsTotal: number;
  results: CanonicalRebuildOrgResult[] | null;
  error: string | null;
}

const KEY = '__glookerCanonicalRebuild';

function idle(): RebuildProgress {
  return { running: false, startedAt: null, finishedAt: null, currentOrg: null, orgsDone: 0, orgsTotal: 0, results: null, error: null };
}

function store(): { p: RebuildProgress } {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = { p: idle() };
  return g[KEY];
}

export function getRebuildProgress(): RebuildProgress {
  return { ...store().p };
}

/**
 * Acquires the rebuild lock (throws RebuildRunningError if held), then runs the
 * rebuild in the background. The background promise never rejects.
 */
export async function startBackgroundRebuild(): Promise<void> {
  const holder = `admin-${process.pid}-${Date.now()}`;
  const snapshot = await acquireRebuildLock(holder);
  const s = store();
  s.p = { ...idle(), running: true, startedAt: snapshot.startedAt };

  void (async () => {
    try {
      const results = await runRebuild(holder, snapshot, {
        onProgress: (org, done, total) => {
          s.p.currentOrg = org;
          s.p.orgsDone = done;
          s.p.orgsTotal = total;
        },
      });
      s.p.results = results;
    } catch (e: any) {
      s.p.error = e?.message ? String(e.message) : String(e);
    } finally {
      try { clearRangeCache(); } catch { /* never reject */ }
      s.p.running = false;
      s.p.currentOrg = null;
      s.p.finishedAt = new Date().toISOString();
    }
  })();
}
