/**
 * In-process progress store. Uses globalThis to survive Next.js
 * hot module reloading in dev mode.
 */

export interface ReportProgress {
  status:          'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  step:            string;
  totalRepos:      number;
  processedRepos:  number;
  totalCommits:    number;
  analyzedCommits: number;
  error?:          string;
  logs:            string[];
}

const globalStore = globalThis as typeof globalThis & {
  __glooker_progress?: Map<string, ReportProgress>;
};

if (!globalStore.__glooker_progress) {
  globalStore.__glooker_progress = new Map();
}

const store = globalStore.__glooker_progress;

export function initProgress(id: string): void {
  store.set(id, {
    status:          'pending',
    step:            'Initializing…',
    totalRepos:      0,
    processedRepos:  0,
    totalCommits:    0,
    analyzedCommits: 0,
    logs:            [],
  });
}

export function updateProgress(id: string, patch: Partial<ReportProgress>): void {
  const current = store.get(id);
  if (current) store.set(id, { ...current, ...patch });
}

export function addLog(id: string, message: string): void {
  const current = store.get(id);
  if (current) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York' });
    current.logs.push(`[${ts}] ${message}`);
    if (current.logs.length > 200) current.logs.splice(0, current.logs.length - 200);
  }
}

export function getProgress(id: string): ReportProgress | null {
  return store.get(id) || null;
}

export function clearProgress(id: string): void {
  store.delete(id);
}
