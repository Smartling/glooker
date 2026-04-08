import fs from 'fs';
import path from 'path';
import os from 'os';

// Must set LOG_DIR before importing logger — it reads at module level
let testLogDir: string;

beforeEach(() => {
  testLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-log-'));
  process.env.LOG_DIR = testLogDir;
  // Re-import to pick up new LOG_DIR — jest.resetModules clears the cache
  jest.resetModules();
});

afterEach(() => {
  delete process.env.LOG_DIR;
  fs.rmSync(testLogDir, { recursive: true, force: true });
});

describe('writeRequestLog', () => {
  it('appends a JSON line to requests.log', async () => {
    const { writeRequestLog } = await import('@/lib/logger');
    const entry = {
      timestamp: '2026-04-08T00:00:00.000Z',
      requestId: 'test-id',
      method: 'GET',
      uri: '/api/health',
      query: '',
      statusCode: 200,
      durationMs: 5,
      userEmail: null,
    };
    await writeRequestLog(entry);
    const content = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8');
    expect(JSON.parse(content.trim())).toEqual(entry);
  });

  it('appends multiple entries as separate lines', async () => {
    const { writeRequestLog } = await import('@/lib/logger');
    const entry = {
      timestamp: '2026-04-08T00:00:00.000Z',
      requestId: 'id-1',
      method: 'GET',
      uri: '/api/health',
      query: '',
      statusCode: 200,
      durationMs: 5,
      userEmail: null,
    };
    await writeRequestLog(entry);
    await writeRequestLog({ ...entry, requestId: 'id-2' });
    const lines = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).requestId).toBe('id-1');
    expect(JSON.parse(lines[1]).requestId).toBe('id-2');
  });
});

describe('writeErrorLog', () => {
  it('appends a JSON line to errors.log', async () => {
    const { writeErrorLog } = await import('@/lib/logger');
    const entry = {
      timestamp: '2026-04-08T00:00:00.000Z',
      requestId: 'test-id',
      method: 'POST',
      uri: '/api/report',
      query: '',
      statusCode: 500,
      durationMs: 10,
      userEmail: 'a@b.com',
      error: 'fail',
      stack: 'Error: fail\n    at ...',
    };
    await writeErrorLog(entry);
    const content = fs.readFileSync(path.join(testLogDir, 'errors.log'), 'utf-8');
    expect(JSON.parse(content.trim())).toEqual(entry);
  });
});

describe('no-op when LOG_DIR is unset', () => {
  it('writeRequestLog does nothing', async () => {
    delete process.env.LOG_DIR;
    jest.resetModules();
    const { writeRequestLog } = await import('@/lib/logger');
    // Should not throw
    await writeRequestLog({
      timestamp: '', requestId: '', method: '', uri: '', query: '',
      statusCode: 200, durationMs: 0, userEmail: null,
    });
    // No file created
    expect(fs.readdirSync(testLogDir)).toHaveLength(0);
  });
});

describe('withRequestLog', () => {
  it('calls the original handler and returns its response', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = jest.fn(async () => new Response('ok', { status: 200 }));
    const wrapped = withRequestLog(handler);

    const req = new Request('http://localhost/api/test?org=acme');
    const response = await wrapped(req);

    expect(handler).toHaveBeenCalledWith(req);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('writes request log entry for successful request', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => new Response('ok', { status: 200 });
    const wrapped = withRequestLog(handler);

    await wrapped(new Request('http://localhost/api/report?org=acme'));

    const content = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.method).toBe('GET');
    expect(entry.uri).toBe('/api/report');
    expect(entry.query).toBe('org=acme');
    expect(entry.statusCode).toBe(200);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.userEmail).toBeNull();
    expect(entry.requestId).toBeDefined();
    expect(entry.timestamp).toBeDefined();
  });

  it('writes to errors.log for 4xx status with null error/stack', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    const wrapped = withRequestLog(handler);

    await wrapped(new Request('http://localhost/api/report/999'));

    const errContent = fs.readFileSync(path.join(testLogDir, 'errors.log'), 'utf-8');
    const entry = JSON.parse(errContent.trim());
    expect(entry.statusCode).toBe(404);
    expect(entry.error).toBeNull();
    expect(entry.stack).toBeNull();
  });

  it('catches thrown errors, logs with stack, returns 500 JSON', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => { throw new Error('boom'); };
    const wrapped = withRequestLog(handler);

    const response = await wrapped(new Request('http://localhost/api/fail'));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Internal Server Error' });

    const reqContent = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8');
    expect(JSON.parse(reqContent.trim()).statusCode).toBe(500);

    const errContent = fs.readFileSync(path.join(testLogDir, 'errors.log'), 'utf-8');
    const errEntry = JSON.parse(errContent.trim());
    expect(errEntry.error).toBe('boom');
    expect(errEntry.stack).toContain('Error: boom');
  });

  it('forwards all arguments to the handler (context params)', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = jest.fn(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params;
      return new Response(id, { status: 200 });
    });
    const wrapped = withRequestLog(handler);

    const req = new Request('http://localhost/api/report/abc');
    const ctx = { params: Promise.resolve({ id: 'abc' }) };
    const response = await wrapped(req, ctx);

    expect(handler).toHaveBeenCalledWith(req, ctx);
    expect(await response.text()).toBe('abc');
  });

  it('does not write logs when LOG_DIR is unset', async () => {
    delete process.env.LOG_DIR;
    jest.resetModules();
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => new Response('ok', { status: 200 });
    const wrapped = withRequestLog(handler);

    await wrapped(new Request('http://localhost/api/health'));

    expect(fs.readdirSync(testLogDir)).toHaveLength(0);
  });
});
