import fs from 'fs';
import path from 'path';
import { extractUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

// --- Types ---

export interface RequestLogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  uri: string;
  query: string;
  statusCode: number;
  durationMs: number;
  userEmail: string | null;
}

export interface ErrorLogEntry extends RequestLogEntry {
  error: string | null;
  stack: string | null;
}

// --- Configuration ---

const logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : null;
let dirEnsured = false;

function ensureDir(): void {
  if (dirEnsured || !logDir) return;
  fs.mkdirSync(logDir, { recursive: true });
  dirEnsured = true;
}

// --- Pending writes (for flush) ---

const pendingWrites: Promise<void>[] = [];

/** Await all in-flight log writes. Useful for tests and graceful shutdown. */
export function flushLogs(): Promise<void> {
  const all = Promise.all(pendingWrites).then(() => {});
  pendingWrites.length = 0;
  return all;
}

// --- Write functions ---

export async function writeRequestLog(entry: RequestLogEntry): Promise<void> {
  if (!logDir) return;
  try {
    ensureDir();
    await fs.promises.appendFile(path.join(logDir, 'requests.log'), JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[logger] Failed to write request log:', err);
  }
}

export async function writeErrorLog(entry: ErrorLogEntry): Promise<void> {
  if (!logDir) return;
  try {
    ensureDir();
    await fs.promises.appendFile(path.join(logDir, 'errors.log'), JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[logger] Failed to write error log:', err);
  }
}

// --- Wrapper HOF ---

export function withRequestLog<T extends (...args: any[]) => Promise<Response>>(handler: T): T {
  const wrapped = async (...args: any[]): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    // Extract request metadata — Next.js always passes Request as args[0]
    const req = args[0] && typeof args[0] === 'object' && 'url' in args[0] ? args[0] as Request : null;
    let uri = '';
    let query = '';
    let method = '';
    let userEmail: string | null = null;

    if (req) {
      const url = new URL(req.url);
      uri = url.pathname;
      query = url.search.slice(1); // remove leading '?'
      method = req.method;
      userEmail = extractUser(req.headers)?.email ?? null;
    }

    try {
      const response = await handler(...args);
      const durationMs = Date.now() - startTime;
      const statusCode = response.status;

      const logEntry: RequestLogEntry = {
        timestamp: new Date().toISOString(),
        requestId,
        method,
        uri,
        query,
        statusCode,
        durationMs,
        userEmail,
      };

      pendingWrites.push(writeRequestLog(logEntry));

      if (statusCode >= 400) {
        pendingWrites.push(writeErrorLog({ ...logEntry, error: null, stack: null }));
      }

      return response;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? (err.stack ?? null) : null;
      const timestamp = new Date().toISOString();

      const requestEntry: RequestLogEntry = {
        timestamp,
        requestId,
        method,
        uri,
        query,
        statusCode: 500,
        durationMs,
        userEmail,
      };

      pendingWrites.push(writeRequestLog(requestEntry));
      pendingWrites.push(writeErrorLog({ ...requestEntry, error, stack }));

      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  };

  return wrapped as T;
}
