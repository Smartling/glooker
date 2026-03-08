/**
 * In-process progress store. Works fine for single-user local use.
 * Frontend polls GET /api/report/:id/progress to read this.
 */

export interface ReportProgress {
  status:          'pending' | 'running' | 'completed' | 'failed';
  step:            string;
  totalRepos:      number;
  processedRepos:  number;
  totalCommits:    number;
  analyzedCommits: number;
  error?:          string;
  logs:            string[];
}

const store = new Map<string, ReportProgress>();

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
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    current.logs.push(`[${ts}] ${message}`);
    // Keep last 200 lines
    if (current.logs.length > 200) current.logs.splice(0, current.logs.length - 200);
  }
}

export function getProgress(id: string): ReportProgress | null {
  return store.get(id) || null;
}

export function clearProgress(id: string): void {
  store.delete(id);
}
