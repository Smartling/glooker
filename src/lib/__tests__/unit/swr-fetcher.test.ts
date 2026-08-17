import { jsonFetcher } from '@/lib/swr-provider';

/** Build a minimal Response-alike for the fetcher. */
function res(init: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: init.json ?? (() => Promise.resolve({})),
  };
}

/**
 * Capture a rejection and return it. `expect(p).rejects.toThrow(/x/)` reports
 * "Received function did not throw" for a non-Error payload, which is
 * indistinguishable from the promise resolving (see CLAUDE.md).
 */
async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    const value = await p;
    throw new Error(`expected a rejection, got resolved value: ${JSON.stringify(value)}`);
  } catch (err) {
    return err;
  }
}

describe('jsonFetcher', () => {
  const mockFetch = jest.fn();

  beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch; });
  beforeEach(() => { mockFetch.mockReset(); });

  it('returns the parsed body on success', async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: true, json: async () => ({ epics: [] }) }));
    await expect(jsonFetcher('/api/projects')).resolves.toEqual({ epics: [] });
  });

  it('throws the API\'s own error message, not the bare status code', async () => {
    // The message the whole first-run migration story depends on. Before this,
    // it reached the user as "Error: 404".
    const apiError = 'No Jira projects configured. Add one in Settings → Projects.';
    mockFetch.mockResolvedValueOnce(res({
      ok: false, status: 404, json: async () => ({ error: apiError }),
    }));

    const err = await rejection(jsonFetcher('/api/projects?org=Smartling'));
    expect((err as Error).message).toBe(apiError);
  });

  it('falls back to the status code when the body is not JSON', async () => {
    mockFetch.mockResolvedValueOnce(res({
      ok: false, status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
    }));

    const err = await rejection(jsonFetcher('/api/projects'));
    // The status code, not the parse error — the parse failure must not
    // shadow the real one.
    expect((err as Error).message).toBe('502');
  });

  it('falls back to the status code when the JSON carries no error field', async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: false, status: 500, json: async () => ({}) }));
    expect(((await rejection(jsonFetcher('/api/x'))) as Error).message).toBe('500');
  });

  it('falls back to the status code on a null body', async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: false, status: 503, json: async () => null }));
    expect(((await rejection(jsonFetcher('/api/x'))) as Error).message).toBe('503');
  });

  it('falls back to the status code on a blank error string', async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: false, status: 400, json: async () => ({ error: '   ' }) }));
    expect(((await rejection(jsonFetcher('/api/x'))) as Error).message).toBe('400');
  });

  it('ignores a non-string error field', async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: false, status: 400, json: async () => ({ error: { code: 7 } }) }));
    expect(((await rejection(jsonFetcher('/api/x'))) as Error).message).toBe('400');
  });

  it('rejects with a real Error, so SWR consumers can read `.message`', async () => {
    mockFetch.mockResolvedValueOnce(res({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }));
    expect(await rejection(jsonFetcher('/api/x'))).toBeInstanceOf(Error);
  });
});
