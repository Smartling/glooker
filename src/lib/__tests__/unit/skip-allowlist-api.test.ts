jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/auth', () => ({
  __esModule: true,
  requireAdmin: jest.fn().mockResolvedValue(null),
  isAdmin: jest.fn().mockReturnValue(true),
  isAuthEnabled: jest.fn().mockReturnValue(false),
  extractUser: jest.fn().mockReturnValue(null),
}));

import db from '@/lib/db';
import { GET, POST } from '@/app/api/settings/skip-allowlist/route';
import { DELETE } from '@/app/api/settings/skip-allowlist/[login]/route';

const exec = db.execute as jest.Mock;

function req(method: string, body?: any, url = 'http://localhost/api/settings/skip-allowlist'): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => exec.mockReset());

describe('GET /api/settings/skip-allowlist', () => {
  it('returns entries + auto-flagged candidates', async () => {
    exec
      .mockResolvedValueOnce([[
        { github_login: 'oshpak', reason: 'private', added_by: 'seed', added_at: '2026-06-01' },
      ], []])
      .mockResolvedValueOnce([Array(4).fill({ run_metadata: JSON.stringify({ skipped: [{ login: 'newuser' }] }) }), []]);
    const res = await GET(req('GET') as any);
    const json = await res.json();
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].github_login).toBe('oshpak');
    expect(json.autoFlaggedCandidates).toContain('newuser');
  });
});

describe('POST /api/settings/skip-allowlist', () => {
  it('inserts a new entry', async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const res = await POST(req('POST', { github_login: 'flaky', reason: 'private account' }) as any);
    expect(res.status).toBe(200);
    expect(exec).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT.*report_skip_allowlist/i),
      expect.arrayContaining(['flaky', 'private account']),
    );
  });

  it('rejects empty github_login', async () => {
    const res = await POST(req('POST', { github_login: '', reason: 'x' }) as any);
    expect(res.status).toBe(400);
  });

  it('rejects empty reason', async () => {
    const res = await POST(req('POST', { github_login: 'flaky', reason: '' }) as any);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/settings/skip-allowlist/[login]', () => {
  it('removes the entry', async () => {
    exec.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const res = await DELETE(req('DELETE', null, 'http://localhost/api/settings/skip-allowlist/flaky') as any, {
      params: Promise.resolve({ login: 'flaky' }),
    } as any);
    expect(res.status).toBe(200);
    expect(exec).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE.*report_skip_allowlist/i),
      ['flaky'],
    );
  });
});
