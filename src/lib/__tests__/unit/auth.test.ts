import { extractUser } from '@/lib/auth';

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
    expect(extractUser(headers)).toEqual({ email: 'user@example.com', sub: 'abc123' });
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
    expect(extractUser(headers)).toEqual({ email: 'a@b.com', sub: '1' });
  });
});
