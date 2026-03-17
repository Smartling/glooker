describe('smartling-auth', () => {
  const originalEnv = { ...process.env };
  let mod: typeof import('@/lib/smartling-auth');

  beforeEach(() => {
    process.env.SMARTLING_BASE_URL = 'https://api.smartling.test';
    process.env.SMARTLING_USER_IDENTIFIER = 'user-id';
    process.env.SMARTLING_USER_SECRET = 'user-secret';

    jest.resetModules();
    // Reimport fresh to clear token cache
    mod = require('@/lib/smartling-auth');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('fetches token from Smartling auth endpoint', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: {
          data: { accessToken: 'tok-123', expiresIn: 3600 },
        },
      }),
    } as any);

    const token = await mod.getAccessToken();
    expect(token).toBe('tok-123');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.smartling.test/auth-api/v2/authenticate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userIdentifier: 'user-id', userSecret: 'user-secret' }),
      }),
    );
  });

  it('returns cached token on second call', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          data: { accessToken: 'tok-cached', expiresIn: 3600 },
        },
      }),
    } as any);

    await mod.getAccessToken();
    await mod.getAccessToken();

    // Only one fetch call — second call used cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on auth failure', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as any);

    await expect(mod.getAccessToken()).rejects.toThrow('Smartling auth failed: 401 Unauthorized');
  });
});
