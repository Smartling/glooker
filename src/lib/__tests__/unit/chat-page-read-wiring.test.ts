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

import { MCPClient } from '@mastra/mcp';
import { Mastra } from '@mastra/core';
import { CHAT_SYSTEM } from '@/lib/chat/engines/types';
import { PAGE_READ_TOOL_ID } from '@/lib/chat/context/page-read-tool';
import { pendingFrom, resolvePageRead } from '@/lib/chat/engines/mastra';
import { _resetPageStore, takePageExtract } from '@/lib/chat/context/page-store';

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

// Finding 1: /api/chat's providePage branch is open HTTP — a crafted POST could
// name a pending write tool's runId/toolCallId instead of the page-read one the
// shipped client is the only caller of. resolvePageRead must confirm, via
// listSuspendedRuns(), that the suspended tool it's about to resume really is
// readCurrentPage before ever calling approveToolCallGenerate.
describe('resolvePageRead', () => {
  const baseOpts = {
    mcpUrl: 'http://127.0.0.1:3000/api/mcp',
    forward: {},
    org: 'acme',
    baseUrl: 'http://localhost:3000',
    isAdmin: true,
  };
  const extract = { path: '/x', title: 't', heading: 'h', text: 'body' };

  function mockAgentEnv(suspendedRuns: any[], approveResult?: any) {
    const approveToolCallGenerate = jest.fn().mockResolvedValue(
      approveResult ?? { finishReason: 'stop', text: 'answered' },
    );
    const listSuspendedRuns = jest.fn().mockResolvedValue({ runs: suspendedRuns });
    (Mastra as unknown as jest.Mock).mockImplementation(() => ({
      getAgent: () => ({ listSuspendedRuns, approveToolCallGenerate }),
    }));
    return { listSuspendedRuns, approveToolCallGenerate };
  }

  beforeEach(() => {
    _resetPageStore();
    (MCPClient as jest.Mock).mockImplementation(() => ({
      listToolsWithErrors: jest.fn().mockResolvedValue({
        tools: { dummyTool: { execute: jest.fn() } },
        errors: [],
      }),
      disconnect: jest.fn().mockResolvedValue(undefined),
    }));
  });

  it('refuses to resume a suspended run that is waiting on a different tool', async () => {
    const { approveToolCallGenerate } = mockAgentEnv([
      { runId: 'run-1', toolCalls: [{ toolCallId: 'tool-1', toolName: 'startReportRun' }] },
    ]);

    const result = await resolvePageRead({ ...baseOpts, runId: 'run-1', toolCallId: 'tool-1', extract });

    expect(result.refused).toMatch(/not waiting on a page read/i);
    expect(result.pendingApproval).toBeUndefined();
    expect(approveToolCallGenerate).not.toHaveBeenCalled();
    // A refused resume must not have stashed the extract for a later retry.
    expect(takePageExtract('run-1')).toBeUndefined();
  });

  it('refuses an unknown/expired runId the same way (no matching suspended run at all)', async () => {
    const { approveToolCallGenerate } = mockAgentEnv([]);

    const result = await resolvePageRead({ ...baseOpts, runId: 'never-suspended', toolCallId: 'tool-1', extract });

    expect(result.refused).toBeTruthy();
    expect(approveToolCallGenerate).not.toHaveBeenCalled();
  });

  it('resumes when the suspended tool call really is readCurrentPage', async () => {
    mockAgentEnv([
      { runId: 'run-2', toolCalls: [{ toolCallId: 'tool-2', toolName: PAGE_READ_TOOL_ID }] },
    ]);

    const result = await resolvePageRead({ ...baseOpts, runId: 'run-2', toolCallId: 'tool-2', extract });

    expect(result.refused).toBeUndefined();
    expect(result.response).toBe('answered');
  });

  it('stores the extract before resuming a genuine page-read suspend', async () => {
    mockAgentEnv([
      { runId: 'run-3', toolCalls: [{ toolCallId: 'tool-3', toolName: PAGE_READ_TOOL_ID }] },
    ]);

    await resolvePageRead({ ...baseOpts, runId: 'run-3', toolCallId: 'tool-3', extract });

    expect(takePageExtract('run-3')).toEqual(extract);
  });

  it('resumes WITHOUT storing an extract when none was supplied (Finding 3 degradation path)', async () => {
    const { approveToolCallGenerate } = mockAgentEnv([
      { runId: 'run-4', toolCalls: [{ toolCallId: 'tool-4', toolName: PAGE_READ_TOOL_ID }] },
    ]);

    const result = await resolvePageRead({ ...baseOpts, runId: 'run-4', toolCallId: 'tool-4', extract: null });

    expect(result.refused).toBeUndefined();
    expect(approveToolCallGenerate).toHaveBeenCalledWith({ runId: 'run-4', toolCallId: 'tool-4' });
    expect(takePageExtract('run-4')).toBeUndefined();
  });
});
