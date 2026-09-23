// mastra.ts pulls in @mastra/core's Agent/Mastra classes and @ai-sdk/anthropic,
// which are ESM-only like @octokit/rest (see CLAUDE.md gotcha) — importing the
// real module here dies with "Cannot use import statement outside a module"
// deep in a transitive dependency. Mocking with the factory form, before the
// import below, sidesteps that without touching jest's transform config.
jest.mock('@mastra/core/agent', () => ({ Agent: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@mastra/core', () => ({ Mastra: jest.fn().mockImplementation(() => ({ getAgent: jest.fn() })) }));
jest.mock('@mastra/mcp', () => ({ MCPClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@mastra/libsql', () => ({ LibSQLStore: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/chat/smartling-anthropic', () => ({
  createSmartlingAnthropic: jest.fn().mockReturnValue(jest.fn()),
}));

import { CHAT_SYSTEM } from '@/lib/chat/engines/types';
import { PAGE_READ_TOOL_ID } from '@/lib/chat/context/page-read-tool';
import { pendingFrom } from '@/lib/chat/engines/mastra';

describe('system prompt', () => {
  it('names the page-read tool so the model knows it exists', () => {
    expect(CHAT_SYSTEM).toContain(PAGE_READ_TOOL_ID);
  });

  it('tells the model it cannot see the screen unaided', () => {
    expect(CHAT_SYSTEM.toLowerCase()).toContain('cannot see');
  });

  it('warns that the result is read from the page, not fetched', () => {
    expect(CHAT_SYSTEM.toLowerCase()).toContain('rendered page');
  });
});

describe('pendingFrom', () => {
  const started = Date.now();

  it('routes a readCurrentPage suspend to pendingPageRead', () => {
    const res = {
      runId: 'run-1',
      text: '',
      suspendPayload: {
        toolCallId: 'tool-1',
        toolName: PAGE_READ_TOOL_ID,
        args: { question: 'what page?' },
      },
    };

    const result = pendingFrom(res, 3, [], started);

    expect(result.pendingPageRead).toEqual({
      runId: 'run-1',
      toolCallId: 'tool-1',
      question: 'what page?',
    });
    expect(result.pendingApproval).toBeUndefined();
  });

  it('still routes a write-tool suspend to pendingApproval', () => {
    const res = {
      runId: 'run-2',
      text: '',
      suspendPayload: {
        toolCallId: 'tool-2',
        toolName: 'startReportRun',
        args: { periodDays: 14 },
      },
    };

    const result = pendingFrom(res, 3, [], started);

    expect(result.pendingApproval).toEqual({
      runId: 'run-2',
      toolCallId: 'tool-2',
      toolName: 'startReportRun',
      args: { periodDays: 14 },
    });
    expect(result.pendingPageRead).toBeUndefined();
  });

  it('keeps the approval fallback response text when the model produced none', () => {
    const res = {
      runId: 'run-3',
      text: '',
      suspendPayload: {
        toolCallId: 'tool-3',
        toolName: 'startReportRun',
        args: { periodDays: 14 },
      },
    };

    const result = pendingFrom(res, 3, [], started);

    expect(result.response).toContain('startReportRun');
    expect(result.response).toContain(JSON.stringify({ periodDays: 14 }));
  });
});
