/**
 * Tests for the developer list deduplication logic used by /api/developers.
 * We test the core dedup algorithm in isolation since the API route wraps DB calls.
 */

describe('developer list deduplication', () => {
  // Simulate the dedup logic from the API route
  function dedup(rows: Array<{ github_login: string; github_name: string | null; avatar_url: string | null; created_at: string }>) {
    // Sort by created_at DESC (most recent first) — same as the SQL ORDER BY
    const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const seen = new Map<string, any>();
    for (const row of sorted) {
      if (!seen.has(row.github_login)) {
        seen.set(row.github_login, {
          github_login: row.github_login,
          github_name: row.github_name || null,
          avatar_url: row.avatar_url || null,
        });
      }
    }
    return [...seen.values()];
  }

  it('deduplicates by github_login, keeping the most recent name/avatar', () => {
    const rows = [
      { github_login: 'alice', github_name: 'Alice Old', avatar_url: 'old.png', created_at: '2026-01-01' },
      { github_login: 'alice', github_name: 'Alice New', avatar_url: 'new.png', created_at: '2026-03-01' },
      { github_login: 'bob', github_name: 'Bob', avatar_url: 'bob.png', created_at: '2026-02-01' },
    ];
    const result = dedup(rows);
    expect(result).toHaveLength(2);
    expect(result.find(d => d.github_login === 'alice')?.github_name).toBe('Alice New');
    expect(result.find(d => d.github_login === 'alice')?.avatar_url).toBe('new.png');
  });

  it('handles null github_name gracefully', () => {
    const rows = [
      { github_login: 'noname', github_name: null, avatar_url: null, created_at: '2026-03-01' },
    ];
    const result = dedup(rows);
    expect(result).toHaveLength(1);
    expect(result[0].github_name).toBeNull();
  });

  it('returns empty array for empty input', () => {
    expect(dedup([])).toEqual([]);
  });

  it('preserves order by most recent report', () => {
    const rows = [
      { github_login: 'early', github_name: 'Early', avatar_url: null, created_at: '2026-01-01' },
      { github_login: 'late', github_name: 'Late', avatar_url: null, created_at: '2026-03-15' },
      { github_login: 'mid', github_name: 'Mid', avatar_url: null, created_at: '2026-02-01' },
    ];
    const result = dedup(rows);
    expect(result.map(d => d.github_login)).toEqual(['late', 'mid', 'early']);
  });

  // Simulate the filter logic from the API route
  function filterDevs(devs: Array<{ github_login: string; github_name: string | null }>, q: string) {
    const lower = q.toLowerCase();
    return devs.filter(d =>
      d.github_login.toLowerCase().includes(lower) ||
      (d.github_name || '').toLowerCase().includes(lower)
    );
  }

  it('filters by login substring', () => {
    const devs = [
      { github_login: 'alice-dev', github_name: 'Alice Chen' },
      { github_login: 'bob-eng', github_name: 'Bob Smith' },
    ];
    expect(filterDevs(devs, 'alice')).toHaveLength(1);
    expect(filterDevs(devs, 'alice')[0].github_login).toBe('alice-dev');
  });

  it('filters by first name', () => {
    const devs = [
      { github_login: 'adev', github_name: 'Alice Chen' },
      { github_login: 'bdev', github_name: 'Bob Smith' },
    ];
    expect(filterDevs(devs, 'alice')).toHaveLength(1);
  });

  it('filters by last name', () => {
    const devs = [
      { github_login: 'adev', github_name: 'Alice Chen' },
      { github_login: 'bdev', github_name: 'Bob Smith' },
    ];
    expect(filterDevs(devs, 'smith')).toHaveLength(1);
    expect(filterDevs(devs, 'smith')[0].github_login).toBe('bdev');
  });

  it('filter is case insensitive', () => {
    const devs = [{ github_login: 'AliceDev', github_name: 'ALICE CHEN' }];
    expect(filterDevs(devs, 'alice')).toHaveLength(1);
    expect(filterDevs(devs, 'ALICE')).toHaveLength(1);
  });

  it('returns all when query is empty', () => {
    const devs = [
      { github_login: 'a', github_name: 'A' },
      { github_login: 'b', github_name: 'B' },
    ];
    expect(filterDevs(devs, '')).toHaveLength(2);
  });

  it('handles null github_name in filter without crashing', () => {
    const devs = [{ github_login: 'noname', github_name: null }];
    expect(filterDevs(devs, 'noname')).toHaveLength(1);
    expect(filterDevs(devs, 'anything')).toHaveLength(0);
  });
});

describe('team member assignment logic', () => {
  // Simulate the "not in a team" computation
  function getUnassigned(
    devs: Array<{ github_login: string }>,
    teams: Array<{ members: string[] }>,
  ) {
    const assigned = new Set(teams.flatMap(t => t.members));
    return devs.filter(d => !assigned.has(d.github_login));
  }

  it('returns all devs when no teams exist', () => {
    const devs = [{ github_login: 'a' }, { github_login: 'b' }];
    expect(getUnassigned(devs, [])).toHaveLength(2);
  });

  it('excludes devs assigned to any team', () => {
    const devs = [{ github_login: 'a' }, { github_login: 'b' }, { github_login: 'c' }];
    const teams = [{ members: ['a'] }, { members: ['c'] }];
    const result = getUnassigned(devs, teams);
    expect(result).toHaveLength(1);
    expect(result[0].github_login).toBe('b');
  });

  it('returns empty when all devs are assigned', () => {
    const devs = [{ github_login: 'a' }, { github_login: 'b' }];
    const teams = [{ members: ['a', 'b'] }];
    expect(getUnassigned(devs, teams)).toHaveLength(0);
  });

  it('handles a dev appearing in multiple teams', () => {
    const devs = [{ github_login: 'a' }, { github_login: 'b' }];
    const teams = [{ members: ['a'] }, { members: ['a'] }];
    const result = getUnassigned(devs, teams);
    expect(result).toHaveLength(1);
    expect(result[0].github_login).toBe('b');
  });

  // Simulate team filter on report page
  function applyTeamFilter(teamMembers: string[], developers: Array<{ github_login: string }>) {
    const memberSet = new Set(teamMembers);
    return developers.filter(d => memberSet.has(d.github_login));
  }

  it('filters developers by team membership', () => {
    const devs = [
      { github_login: 'alice' },
      { github_login: 'bob' },
      { github_login: 'carol' },
    ];
    const team = { members: ['alice', 'carol'] };
    expect(applyTeamFilter(team.members, devs)).toHaveLength(2);
    expect(applyTeamFilter(team.members, devs).map(d => d.github_login)).toEqual(['alice', 'carol']);
  });

  it('returns empty if no team members match developers', () => {
    const devs = [{ github_login: 'alice' }];
    const team = { members: ['unknown'] };
    expect(applyTeamFilter(team.members, devs)).toHaveLength(0);
  });
});
