// Route-dispatch mocks — must precede the `@/app/api/chat/route` import below.
// Keeps this test on the actual /api/chat dispatch/systemSuffix wiring without
// pulling in real Mastra/proxy/db work.
jest.mock('@/lib/chat/agent', () => ({ runChatAgent: jest.fn() }));
jest.mock('@/lib/chat/engines/control', () => ({
  runControlEngine: jest.fn().mockResolvedValue({
    response: 'ok', toolCalls: [], engine: 'control', toolCount: 0, ms: 1,
  }),
}));
jest.mock('@/lib/chat/engines/mastra', () => ({
  runMastraEngine: jest.fn().mockResolvedValue({
    response: 'ok', toolCalls: [], engine: 'mastra', toolCount: 0, ms: 1,
  }),
  resolveMastraApproval: jest.fn().mockResolvedValue({
    response: 'done', toolCalls: [], engine: 'mastra', toolCount: 0, ms: 1,
  }),
  resolvePageRead: jest.fn().mockResolvedValue({
    response: 'read', toolCalls: [], engine: 'mastra', toolCount: 0, ms: 1,
  }),
}));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn().mockResolvedValue({ githubLogin: null, isAdmin: false, authDisabled: true }),
}));

import { buildPreamble } from '@/lib/chat/context/preamble';
import { CHAT_SYSTEM } from '@/lib/chat/engines/types';
import type { PageContext } from '@/lib/chat/context/types';
import { POST } from '@/app/api/chat/route';
import { runMastraEngine, resolveMastraApproval, resolvePageRead } from '@/lib/chat/engines/mastra';

const ctx: PageContext = {
  kind: 'developer-report',
  label: 'Developer · @junky',
  params: { reportId: 'abc123', login: 'junky' },
  source: 'route',
};

describe('system prompt composition', () => {
  it('keeps the base instructions and appends the view', () => {
    const composed = CHAT_SYSTEM + buildPreamble(ctx);
    expect(composed).toContain('Glooker Assistant');
    expect(composed).toContain('Developer · @junky');
  });

  it('is byte-identical to the base prompt when there is no context', () => {
    expect(CHAT_SYSTEM + buildPreamble(null)).toBe(CHAT_SYSTEM);
  });
});

function postReq(body: unknown) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('systemSuffix parity across a message and its approval resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (runMastraEngine as jest.Mock).mockResolvedValue({
      response: 'ok', toolCalls: [], engine: 'mastra', toolCount: 0, ms: 1,
    });
    (resolveMastraApproval as jest.Mock).mockResolvedValue({
      response: 'done', toolCalls: [], engine: 'mastra', toolCount: 0, ms: 1,
    });
  });

  it('passes the same systemSuffix to a normal mastra message and to an approve/decline action carrying the same page context', async () => {
    await POST(postReq({
      org: 'acme',
      engine: 'mastra',
      pageContext: ctx,
      messages: [{ role: 'user', content: 'hi' }],
    }) as any);

    await POST(postReq({
      org: 'acme',
      engine: 'mastra',
      pageContext: ctx,
      action: 'approve',
      runId: 'run-1',
      toolCallId: 'tool-1',
    }) as any);

    expect(runMastraEngine).toHaveBeenCalledTimes(1);
    expect(resolveMastraApproval).toHaveBeenCalledTimes(1);

    const messageOpts = (runMastraEngine as jest.Mock).mock.calls[0][0];
    const approvalOpts = (resolveMastraApproval as jest.Mock).mock.calls[0][0];

    // Both must carry the real preamble for this context — neither branch may
    // silently drop pageContext and fall back to buildPreamble(undefined) === ''.
    expect(messageOpts.systemSuffix).toBe(buildPreamble(ctx));
    expect(approvalOpts.systemSuffix).toBe(buildPreamble(ctx));

    // The resumed run must see exactly what the run it resumes saw — an
    // approval is not a fresh page view, so its system prompt cannot regress
    // to context-free just because it took the action branch.
    expect(approvalOpts.systemSuffix).toBe(messageOpts.systemSuffix);
  });
});

// Finding 4: there was no route-level coverage of providePage at all — the
// mastra engine mock above didn't even export resolvePageRead, so it was
// `undefined` at the call site and nothing exercised route.ts's dispatch,
// its 400s, or the Finding 3 degrade-gracefully path.
describe('POST /api/chat — action: providePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (resolvePageRead as jest.Mock).mockResolvedValue({
      response: 'read', toolCalls: [], engine: 'mastra', toolCount: 0, ms: 1,
    });
  });

  it('reaches resolvePageRead with the clamped extract for a valid request', async () => {
    const res = await POST(postReq({
      org: 'acme',
      engine: 'mastra',
      action: 'providePage',
      runId: 'run-1',
      toolCallId: 'tool-1',
      pageExtract: { path: ' /x ', title: 'Settings', heading: 'Settings', text: '  Teams: 11  ' },
    }) as any);

    expect(res.status).toBe(200);
    expect(resolvePageRead).toHaveBeenCalledTimes(1);
    const opts = (resolvePageRead as jest.Mock).mock.calls[0][0];
    expect(opts.runId).toBe('run-1');
    expect(opts.toolCallId).toBe('tool-1');
    // clampExtract collapses whitespace and trims — the route must forward
    // that clamped shape, not the raw request body.
    expect(opts.extract).toEqual({ path: '/x', title: 'Settings', heading: 'Settings', text: 'Teams: 11' });
  });

  it('returns 400 without calling resolvePageRead when runId or toolCallId is missing', async () => {
    const res = await POST(postReq({
      org: 'acme',
      engine: 'mastra',
      action: 'providePage',
      toolCallId: 'tool-1',
      pageExtract: { path: '/x', text: 'body' },
    }) as any);

    expect(res.status).toBe(400);
    expect(resolvePageRead).not.toHaveBeenCalled();
  });

  it('still resumes (200), rather than 400ing, when the extract is unusable', async () => {
    const res = await POST(postReq({
      org: 'acme',
      engine: 'mastra',
      action: 'providePage',
      runId: 'run-2',
      toolCallId: 'tool-2',
      pageExtract: { path: '/x', title: '', heading: '', text: '   ' },
    }) as any);

    expect(res.status).toBe(200);
    expect(resolvePageRead).toHaveBeenCalledTimes(1);
    const opts = (resolvePageRead as jest.Mock).mock.calls[0][0];
    // Nothing usable was scraped — the route must still resume so the tool's
    // own "page content unavailable" branch can fire, rather than leaving the
    // suspended run to hang.
    expect(opts.extract).toBeNull();
  });

  it('returns 400, not 500, when resolvePageRead refuses an unknown/expired runId', async () => {
    (resolvePageRead as jest.Mock).mockResolvedValue({
      response: 'refused',
      toolCalls: [], engine: 'mastra', toolCount: 0, ms: 1,
      refused: 'That run is not waiting on a page read — refusing to resume it with page content.',
    });

    const res = await POST(postReq({
      org: 'acme',
      engine: 'mastra',
      action: 'providePage',
      runId: 'unknown-run',
      toolCallId: 'tool-3',
      pageExtract: { path: '/x', text: 'body' },
    }) as any);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not waiting on a page read/i);
  });
});
