import { extractUser, requireAdmin } from '@/lib/auth';

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.fakesignature`;
}

describe('extractUser', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.AUTH_ENABLED = process.env.AUTH_ENABLED;
    savedEnv.AUTH_HEADER = process.env.AUTH_HEADER;
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_HEADER = 'x-amzn-oidc-data';
  });

  afterEach(() => {
    process.env.AUTH_ENABLED = savedEnv.AUTH_ENABLED;
    process.env.AUTH_HEADER = savedEnv.AUTH_HEADER;
  });

  it('returns null when AUTH_ENABLED is not true', () => {
    process.env.AUTH_ENABLED = 'false';
    const headers = new Headers({ 'x-amzn-oidc-data': makeJwt({ email: 'a@b.com', sub: '123' }) });
    expect(extractUser(headers)).toBeNull();
  });

  it('extracts email and sub from valid JWT', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': makeJwt({ email: 'user@example.com', sub: 'abc123' }) });
    expect(extractUser(headers)).toEqual({ email: 'user@example.com', sub: 'abc123', name: null, groups: [] });
  });

  it('returns null when header is missing', () => {
    const headers = new Headers();
    expect(extractUser(headers)).toBeNull();
  });

  it('returns null for malformed JWT (no dots)', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': 'notajwt' });
    expect(extractUser(headers)).toBeNull();
  });

  it('returns null for invalid base64', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': 'a.!!!invalid!!!.c' });
    expect(extractUser(headers)).toBeNull();
  });

  it('returns null when payload has no email', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': makeJwt({ sub: '123' }) });
    expect(extractUser(headers)).toBeNull();
  });

  it('uses custom header name from AUTH_HEADER', () => {
    process.env.AUTH_HEADER = 'x-custom-auth';
    const headers = new Headers({ 'x-custom-auth': makeJwt({ email: 'a@b.com', sub: '1' }) });
    expect(extractUser(headers)).toEqual({ email: 'a@b.com', sub: '1', name: null, groups: [] });
  });

  it('extracts name and groups from JWT payload', () => {
    const headers = new Headers({
      'x-amzn-oidc-data': makeJwt({
        email: 'user@example.com', sub: 'abc',
        name: 'Test User',
        groups: ['splunk-admin', 'Everyone'],
      }),
    });
    const result = extractUser(headers);
    expect(result).toEqual({
      email: 'user@example.com', sub: 'abc',
      name: 'Test User', groups: ['splunk-admin', 'Everyone'],
    });
  });

  it('returns null name and empty groups when missing', () => {
    const headers = new Headers({
      'x-amzn-oidc-data': makeJwt({ email: 'a@b.com', sub: '1' }),
    });
    const result = extractUser(headers);
    expect(result?.name).toBeNull();
    expect(result?.groups).toEqual([]);
  });
});

describe('requireAdmin', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.AUTH_ENABLED = process.env.AUTH_ENABLED;
    savedEnv.AUTH_HEADER = process.env.AUTH_HEADER;
    savedEnv.AUTH_ADMIN_GROUP = process.env.AUTH_ADMIN_GROUP;
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_HEADER = 'x-amzn-oidc-data';
    process.env.AUTH_ADMIN_GROUP = 'splunk-admin';
  });

  afterEach(() => {
    process.env.AUTH_ENABLED = savedEnv.AUTH_ENABLED;
    process.env.AUTH_HEADER = savedEnv.AUTH_HEADER;
    process.env.AUTH_ADMIN_GROUP = savedEnv.AUTH_ADMIN_GROUP;
  });

  function makeReq(payload?: object): Request {
    const headers: Record<string, string> = {};
    if (payload) {
      const h = Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64');
      const b = Buffer.from(JSON.stringify(payload)).toString('base64');
      headers['x-amzn-oidc-data'] = `${h}.${b}.sig`;
    }
    return new Request('http://localhost/api/test', { headers });
  }

  it('returns null (allow) when AUTH_ENABLED is false', async () => {
    process.env.AUTH_ENABLED = 'false';
    expect(await requireAdmin(makeReq())).toBeNull();
  });

  it('returns 403 when no JWT header present', async () => {
    const res = await requireAdmin(makeReq());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns 403 when AUTH_ADMIN_GROUP is empty', async () => {
    process.env.AUTH_ADMIN_GROUP = '';
    const res = await requireAdmin(makeReq({ email: 'a@b.com', sub: '1', groups: ['splunk-admin'] }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns 403 when user not in admin group', async () => {
    const res = await requireAdmin(makeReq({ email: 'a@b.com', sub: '1', groups: ['Everyone'] }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns null (allow) when user is in admin group', async () => {
    const res = await requireAdmin(makeReq({ email: 'a@b.com', sub: '1', groups: ['splunk-admin', 'Everyone'] }));
    expect(res).toBeNull();
  });
});
