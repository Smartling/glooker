jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));
jest.mock('@/lib/auth');

import db from '@/lib/db';
import { isAuthEnabled, extractUser } from '@/lib/auth';
import { GET } from '@/app/api/auth/me/route';

const mockExecute = db.execute as jest.Mock;
const mockIsAuthEnabled = isAuthEnabled as jest.Mock;
const mockExtractUser = extractUser as jest.Mock;

function makeRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/me', {
    headers: headers ? new Headers(headers) : new Headers(),
  });
}

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns { enabled: false } when auth is disabled', async () => {
    mockIsAuthEnabled.mockReturnValue(false);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ enabled: false });
    expect(mockExtractUser).not.toHaveBeenCalled();
  });

  it('returns { enabled: true, user: null } when no JWT header', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue(null);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ enabled: true, user: null });
  });

  it('returns full profile when email matches user_mappings', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({ email: 'msogin@smartling.com', sub: '123' });
    mockExecute
      .mockResolvedValueOnce([[{
        github_login: 'msogin',
        github_name: 'Max Sogin',
        avatar_url: 'https://avatars.githubusercontent.com/u/123',
      }], []])
      .mockResolvedValueOnce([[{
        team_name: 'Platform',
        team_color: '#3B82F6',
      }], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      user: {
        email: 'msogin@smartling.com',
        githubLogin: 'msogin',
        name: 'Max Sogin',
        avatarUrl: 'https://avatars.githubusercontent.com/u/123',
        team: { name: 'Platform', color: '#3B82F6' },
      },
    });
  });

  it('returns email-only user when no user_mappings match', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({ email: 'unknown@example.com', sub: '456' });
    mockExecute.mockResolvedValueOnce([[], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      user: {
        email: 'unknown@example.com',
        githubLogin: null,
        name: null,
        avatarUrl: null,
        team: null,
      },
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns user without team when no team_members match', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({ email: 'dev@smartling.com', sub: '789' });
    mockExecute
      .mockResolvedValueOnce([[{
        github_login: 'devuser',
        github_name: 'Dev User',
        avatar_url: null,
      }], []])
      .mockResolvedValueOnce([[], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.user.githubLogin).toBe('devuser');
    expect(body.user.team).toBeNull();
  });
});
