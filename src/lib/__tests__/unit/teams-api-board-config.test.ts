jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/teams/service', () => {
  const actual = jest.requireActual('@/lib/teams/service');
  return {
    ...actual,
    listTeams: jest.fn(),
    createTeam: jest.fn(),
    updateTeam: jest.fn(),
    deleteTeam: jest.fn(),
  };
});

import { POST } from '@/app/api/teams/route';
import { PUT } from '@/app/api/teams/[id]/route';
import { createTeam, updateTeam, TeamDuplicateError, TeamNotFoundError } from '@/lib/teams/service';
import { BoardConfigError } from '@/lib/teams/board-config';
import { requireAdmin } from '@/lib/auth';

const mockCreateTeam = createTeam as jest.Mock;
const mockUpdateTeam = updateTeam as jest.Mock;
const mockRequireAdmin = requireAdmin as jest.Mock;

/** Build a minimal mock NextRequest with a JSON body — no `url`, so
 *  withRequestLog's extractUser branch is never reached (see status-api.test.ts /
 *  due-date-api.test.ts precedent). */
function makeRequest(body: unknown) {
  return { json: () => Promise.resolve(body) } as any;
}

/** Build the params object the [id] route handler expects. */
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(null);
});

describe('POST /api/teams — error mapping', () => {
  it('maps a BoardConfigError from createTeam to 400 with the error message', async () => {
    mockCreateTeam.mockRejectedValue(
      new BoardConfigError('hierarchy must be one of: goal-initiative, owner'),
    );

    const res = await POST(
      makeRequest({ org: 'o', name: 'Research', boardConfig: { hierarchy: 'sideways' } }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('hierarchy must be one of: goal-initiative, owner');
  });

  it('still 409s when createTeam throws TeamDuplicateError (catch-block ordering guard)', async () => {
    mockCreateTeam.mockRejectedValue(new TeamDuplicateError('Research'));

    const res = await POST(makeRequest({ org: 'o', name: 'Research' }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/);
  });
});

describe('PUT /api/teams/[id] — error mapping', () => {
  it('maps a BoardConfigError from updateTeam to 400 with the error message', async () => {
    mockUpdateTeam.mockRejectedValue(
      new BoardConfigError('doneWindowDays must be an integer between 1 and 365'),
    );

    const res = await PUT(
      makeRequest({ boardConfig: { doneWindowDays: 999 } }),
      makeParams('t1'),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('doneWindowDays must be an integer between 1 and 365');
  });

  it('still 404s when updateTeam throws TeamNotFoundError (catch-block ordering guard)', async () => {
    mockUpdateTeam.mockRejectedValue(new TeamNotFoundError('t1'));

    const res = await PUT(makeRequest({ name: 'Renamed' }), makeParams('t1'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
