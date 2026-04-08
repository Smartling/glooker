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
