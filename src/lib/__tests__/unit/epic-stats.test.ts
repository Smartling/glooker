jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/jira/client');
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import { getEpicRingStats, evictEpicStats } from '@/lib/projects/epic-stats';
import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db/index';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockDbExecute = db.execute as jest.Mock;

// Helper: build a Jira child issue
function makeChild(
  key: string,
  opts: Partial<{
    statusCategory: string;
    resolvedAt: string | null;
    assigneeEmail: string | null;
  }> = {},
) {
  return {
    key,
    summary: `Summary for ${key}`,
    status: opts.statusCategory === 'Done' ? 'Done' : 'In Progress',
    statusCategory: opts.statusCategory ?? 'In Progress',
    resolvedAt: opts.resolvedAt ?? null,
    assigneeEmail: opts.assigneeEmail ?? null,
  };
}

// Helper: build a mock Jira client
function makeMockJiraClient(
  children: ReturnType<typeof makeChild>[] = [],
) {
  return {
    searchChildIssues: jest.fn().mockResolvedValue(children),
  };
}

// Helper: a DB row from commit_analyses (phase 2)
function makeCommitRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    commit_sha: 'sha-abc123',
    repo: 'acme/my-repo',
    github_login: 'alice',
    lines_added: 100,
    lines_removed: 20,
    ...overrides,
  };
}

// Helper: a cached epic_stats row (generated_at 1 hour ago — fresh)
function makeCachedRow(overrides: Partial<Record<string, any>> = {}) {
  const d = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
  const generated_at = d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  return {
    total_jiras: 4,
    resolved_jiras: 2,
    remaining_jiras: 2,
    commit_count: 5,
    dev_count: 2,
    lines_added: 300,
    lines_removed: 50,
    repos: JSON.stringify(['acme/my-repo']),
    generated_at,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

// ─── 1. Cache hit (< 24h TTL) ────────────────────────────────────────────────

describe('getEpicRingStats — cache hit', () => {
  it('returns cached stats with cached: true and does not call Jira', async () => {
    const cachedRow = makeCachedRow();
    // Only one DB call: the cache SELECT
    mockDbExecute.mockResolvedValueOnce([[cachedRow], null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.cached).toBe(true);
    expect(result.epicKey).toBe('EPIC-1');
    expect(result.totalJiras).toBe(4);
    expect(result.resolvedJiras).toBe(2);
    expect(result.remainingJiras).toBe(2);
    expect(result.commitCount).toBe(5);
    expect(result.devCount).toBe(2);
    expect(result.linesAdded).toBe(300);
    expect(result.linesRemoved).toBe(50);
    expect(result.repos).toEqual(['acme/my-repo']);
    // Only one DB call — the cache SELECT
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    // Jira should never have been consulted
    expect(mockGetJiraClient).not.toHaveBeenCalled();
  });

  it('parses repos from JSON string in cache row', async () => {
    const cachedRow = makeCachedRow({ repos: JSON.stringify(['acme/repo-a', 'acme/repo-b']) });
    mockDbExecute.mockResolvedValueOnce([[cachedRow], null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.repos).toEqual(['acme/repo-a', 'acme/repo-b']);
    expect(result.cached).toBe(true);
  });

  it('accepts repos as a pre-parsed array in cache row', async () => {
    const cachedRow = makeCachedRow({ repos: ['acme/repo-x'] });
    mockDbExecute.mockResolvedValueOnce([[cachedRow], null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.repos).toEqual(['acme/repo-x']);
  });

  it('returns empty repos array when repos is null in cache row', async () => {
    const cachedRow = makeCachedRow({ repos: null });
    mockDbExecute.mockResolvedValueOnce([[cachedRow], null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.repos).toEqual([]);
  });

  it('coerces numeric columns from strings (DB may return strings)', async () => {
    const cachedRow = makeCachedRow({
      total_jiras: '7',
      resolved_jiras: '3',
      remaining_jiras: '4',
      commit_count: '12',
      dev_count: '5',
      lines_added: '800',
      lines_removed: '150',
    });
    mockDbExecute.mockResolvedValueOnce([[cachedRow], null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.totalJiras).toBe(7);
    expect(result.resolvedJiras).toBe(3);
    expect(result.remainingJiras).toBe(4);
    expect(result.commitCount).toBe(12);
    expect(result.devCount).toBe(5);
    expect(result.linesAdded).toBe(800);
    expect(result.linesRemoved).toBe(150);
  });
});

// ─── 2. Cache miss → Jira fetch + DB commit query + upsert ───────────────────

describe('getEpicRingStats — cache miss', () => {
  // DB call order on a full cache-miss path with seeded commits:
  //   1. epic_stats SELECT → empty (cache miss)
  //   2. Phase 1 seed query (commit_analyses LIKE clauses)
  //   3. user_mappings for assigneeEmails (if any)
  //   4. Phase 2 full commit query
  //   5. INSERT INTO epic_stats (upsert)

  function setupCacheMissPath(opts: {
    children?: ReturnType<typeof makeChild>[];
    seedRows?: any[];
    phase2Rows?: any[];
    mappingRows?: any[];
  } = {}) {
    const {
      children = [
        makeChild('EPIC-1-01', { statusCategory: 'Done', resolvedAt: '2026-03-28' }),
        makeChild('EPIC-1-02', { statusCategory: 'In Progress' }),
      ],
      seedRows = [makeCommitRow()],
      phase2Rows = [makeCommitRow()],
      mappingRows,
    } = opts;

    const jiraClient = makeMockJiraClient(children);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const hasAssigneeEmails = children.some(c => c.assigneeEmail !== null);

    if (hasAssigneeEmails && mappingRows !== undefined) {
      mockDbExecute
        // epic_stats SELECT → miss
        .mockResolvedValueOnce([[], null])
        // Phase 1 seed
        .mockResolvedValueOnce([seedRows, null])
        // user_mappings
        .mockResolvedValueOnce([mappingRows, null])
        // Phase 2
        .mockResolvedValueOnce([phase2Rows, null])
        // Upsert
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    } else {
      mockDbExecute
        // epic_stats SELECT → miss
        .mockResolvedValueOnce([[], null])
        // Phase 1 seed
        .mockResolvedValueOnce([seedRows, null])
        // Phase 2
        .mockResolvedValueOnce([phase2Rows, null])
        // Upsert
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]);
    }

    return jiraClient;
  }

  it('fetches from Jira and DB, returns cached: false on miss', async () => {
    const jiraClient = setupCacheMissPath();

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.cached).toBe(false);
    expect(result.epicKey).toBe('EPIC-1');
    expect(jiraClient.searchChildIssues).toHaveBeenCalledWith('EPIC-1');
  });

  it('calls searchChildIssues on the Jira client', async () => {
    const jiraClient = setupCacheMissPath();

    await getEpicRingStats('EPIC-1', 'acme');

    expect(jiraClient.searchChildIssues).toHaveBeenCalledTimes(1);
    expect(jiraClient.searchChildIssues).toHaveBeenCalledWith('EPIC-1');
  });

  it('upserts into epic_stats table after fetching', async () => {
    setupCacheMissPath();

    await getEpicRingStats('EPIC-1', 'acme');

    const insertCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO epic_stats'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain('EPIC-1');
    expect(insertCall![1]).toContain('acme');
  });
});

// ─── 3. Resolved vs remaining Jira counting ──────────────────────────────────

describe('getEpicRingStats — Jira counting', () => {
  // The cutoff date is NOW() - 14 days. We use a recent date to ensure
  // resolved issues within the window are counted as resolvedJiras.
  function recentDate() {
    const d = new Date();
    d.setDate(d.getDate() - 7); // 7 days ago — within the 14-day window
    return d.toISOString().slice(0, 10);
  }

  function oldDate() {
    const d = new Date();
    d.setDate(d.getDate() - 30); // 30 days ago — outside the 14-day window
    return d.toISOString().slice(0, 10);
  }

  function setupForCounting(children: ReturnType<typeof makeChild>[]) {
    const jiraClient = makeMockJiraClient(children);
    mockGetJiraClient.mockReturnValue(jiraClient);

    // All commits empty → seedRepos/seedLogins empty → phase 2 skipped
    mockDbExecute
      .mockResolvedValueOnce([[], null]) // cache miss
      .mockResolvedValueOnce([[], null]) // phase 1 seed → no results
      // phase 2 skipped (empty seed sets)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // upsert
  }

  it('counts resolved issues within 14-day window correctly', async () => {
    setupForCounting([
      makeChild('EPIC-1-01', { statusCategory: 'Done', resolvedAt: recentDate() }),
      makeChild('EPIC-1-02', { statusCategory: 'Done', resolvedAt: recentDate() }),
      makeChild('EPIC-1-03', { statusCategory: 'In Progress' }),
    ]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.totalJiras).toBe(3);
    expect(result.resolvedJiras).toBe(2);
    expect(result.remainingJiras).toBe(1);
  });

  it('does not count resolved issues outside 14-day window as resolved', async () => {
    setupForCounting([
      makeChild('EPIC-1-01', { statusCategory: 'Done', resolvedAt: oldDate() }),
      makeChild('EPIC-1-02', { statusCategory: 'In Progress' }),
    ]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    // EPIC-1-01 was resolved but outside the window → resolvedJiras = 0
    expect(result.totalJiras).toBe(2);
    expect(result.resolvedJiras).toBe(0);
    expect(result.remainingJiras).toBe(1);
  });

  it('counts Done items with null resolvedAt as not resolved', async () => {
    setupForCounting([
      makeChild('EPIC-1-01', { statusCategory: 'Done', resolvedAt: null }),
      makeChild('EPIC-1-02', { statusCategory: 'In Progress' }),
    ]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.resolvedJiras).toBe(0);
    expect(result.remainingJiras).toBe(1);
  });

  it('returns all zeros when there are no children', async () => {
    setupForCounting([]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.totalJiras).toBe(0);
    expect(result.resolvedJiras).toBe(0);
    expect(result.remainingJiras).toBe(0);
  });
});

// ─── 4. Unique commits (dedup by SHA) and unique devs ────────────────────────

describe('getEpicRingStats — commit deduplication and dev counting', () => {
  it('deduplicates commits by commit_sha', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const dupCommit = makeCommitRow({ commit_sha: 'dup-sha', repo: 'acme/repo', github_login: 'alice', lines_added: 50, lines_removed: 5 });

    mockDbExecute
      .mockResolvedValueOnce([[], null])          // cache miss
      .mockResolvedValueOnce([[dupCommit], null])  // phase 1 seed (seeds alice + acme/repo)
      .mockResolvedValueOnce([[dupCommit, dupCommit], null]) // phase 2: same commit twice
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);   // upsert

    const result = await getEpicRingStats('EPIC-1', 'acme');

    // Despite appearing twice in phase 2, counted once
    expect(result.commitCount).toBe(1);
  });

  it('counts lines only once per unique commit_sha', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const dupCommit = makeCommitRow({ commit_sha: 'dup-sha-2', lines_added: '200', lines_removed: '40' });

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[dupCommit], null])
      .mockResolvedValueOnce([[dupCommit, dupCommit], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.linesAdded).toBe(200);
    expect(result.linesRemoved).toBe(40);
  });

  it('counts unique devs across deduplicated commits', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const commitAlice = makeCommitRow({ commit_sha: 'sha-alice', github_login: 'alice', repo: 'acme/repo' });
    const commitBob = makeCommitRow({ commit_sha: 'sha-bob', github_login: 'bob', repo: 'acme/repo' });
    // alice appears twice with the same SHA (duplicate)
    const commitAliceDup = makeCommitRow({ commit_sha: 'sha-alice', github_login: 'alice', repo: 'acme/repo' });

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[commitAlice], null])
      .mockResolvedValueOnce([[commitAlice, commitBob, commitAliceDup], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    // 2 unique commits (sha-alice once, sha-bob once), 2 unique devs
    expect(result.commitCount).toBe(2);
    expect(result.devCount).toBe(2);
  });

  it('collects unique repos sorted alphabetically', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const commitA = makeCommitRow({ commit_sha: 'sha-1', repo: 'acme/repo-z', github_login: 'alice' });
    const commitB = makeCommitRow({ commit_sha: 'sha-2', repo: 'acme/repo-a', github_login: 'bob' });

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[commitA], null])
      .mockResolvedValueOnce([[commitA, commitB], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.repos).toEqual(['acme/repo-a', 'acme/repo-z']);
  });

  it('returns zero stats when no commits match at all', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    mockDbExecute
      .mockResolvedValueOnce([[], null]) // cache miss
      .mockResolvedValueOnce([[], null]) // phase 1 seed → empty
      // phase 2 skipped (seedRepos=0, seedLogins=0)
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // upsert

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.commitCount).toBe(0);
    expect(result.devCount).toBe(0);
    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
    expect(result.repos).toEqual([]);
  });
});

// ─── 5. Upsert on cache miss ──────────────────────────────────────────────────

describe('getEpicRingStats — upsert', () => {
  it('upserts correct values into epic_stats on cache miss', async () => {
    const children = [
      makeChild('EPIC-1-01', { statusCategory: 'Done', resolvedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) }),
      makeChild('EPIC-1-02', { statusCategory: 'In Progress' }),
    ];
    const jiraClient = makeMockJiraClient(children);
    mockGetJiraClient.mockReturnValue(jiraClient);

    const commit = makeCommitRow({ commit_sha: 'sha-1', repo: 'acme/repo', github_login: 'alice', lines_added: 10, lines_removed: 5 });

    mockDbExecute
      .mockResolvedValueOnce([[], null])           // cache miss
      .mockResolvedValueOnce([[commit], null])      // phase 1 seed
      .mockResolvedValueOnce([[commit], null])      // phase 2
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // upsert

    await getEpicRingStats('EPIC-1', 'acme');

    const upsertCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO epic_stats'),
    );
    expect(upsertCall).toBeDefined();

    const params = upsertCall![1];
    // epic_key, org
    expect(params[0]).toBe('EPIC-1');
    expect(params[1]).toBe('acme');
    // total_jiras = 2, resolved_jiras = 1, remaining_jiras = 1
    expect(params[2]).toBe(2); // totalJiras
    expect(params[3]).toBe(1); // resolvedJiras
    expect(params[4]).toBe(1); // remainingJiras
    // repos should be serialized as JSON string
    const reposParam = params[9];
    expect(typeof reposParam).toBe('string');
    const parsedRepos = JSON.parse(reposParam);
    expect(parsedRepos).toContain('acme/repo');
  });

  it('includes ON DUPLICATE KEY UPDATE in the upsert SQL', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    mockDbExecute
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([[], null])
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    await getEpicRingStats('EPIC-1', 'acme');

    const upsertCall = mockDbExecute.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO epic_stats'),
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall![0]).toContain('ON DUPLICATE KEY UPDATE');
  });
});

// ─── 6. cached flag ───────────────────────────────────────────────────────────

describe('getEpicRingStats — cached flag', () => {
  it('returns cached: true on a fresh cache hit', async () => {
    const cachedRow = makeCachedRow(); // generated 1 hour ago
    mockDbExecute.mockResolvedValueOnce([[cachedRow], null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.cached).toBe(true);
  });

  it('returns cached: false when the cache row is expired (> 24h)', async () => {
    // generated_at is 25 hours ago — beyond the TTL.
    // Use ISO format so new Date() parses it correctly in all environments.
    const generated_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const staleRow = makeCachedRow({ generated_at });

    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    mockDbExecute
      .mockResolvedValueOnce([[staleRow], null]) // stale cache row — treated as miss
      .mockResolvedValueOnce([[], null])          // phase 1 seed
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // upsert

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.cached).toBe(false);
  });

  it('returns cached: false on a genuine cache miss (no row)', async () => {
    const jiraClient = makeMockJiraClient([]);
    mockGetJiraClient.mockReturnValue(jiraClient);

    mockDbExecute
      .mockResolvedValueOnce([[], null]) // no row
      .mockResolvedValueOnce([[], null]) // phase 1 seed
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    const result = await getEpicRingStats('EPIC-1', 'acme');

    expect(result.cached).toBe(false);
  });
});

// ─── 7. evictEpicStats ───────────────────────────────────────────────────────

describe('evictEpicStats', () => {
  it('executes a DELETE for the given epicKey and org', async () => {
    mockDbExecute.mockResolvedValueOnce([{ affectedRows: 1 }, null]);

    await evictEpicStats('EPIC-1', 'acme');

    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDbExecute.mock.calls[0];
    expect(sql).toContain('DELETE FROM epic_stats');
    expect(params).toContain('EPIC-1');
    expect(params).toContain('acme');
  });

  it('does not throw when no rows are deleted', async () => {
    mockDbExecute.mockResolvedValueOnce([{ affectedRows: 0 }, null]);

    await expect(evictEpicStats('EPIC-MISSING', 'acme')).resolves.toBeUndefined();
  });
});

// ─── 8. Throws when Jira client is null ──────────────────────────────────────

describe('getEpicRingStats — Jira not configured', () => {
  it('throws when getJiraClient returns null', async () => {
    // Cache miss
    mockDbExecute.mockResolvedValueOnce([[], null]);
    mockGetJiraClient.mockReturnValue(null);

    await expect(getEpicRingStats('EPIC-1', 'acme')).rejects.toThrow('Jira is not configured');
  });
});
