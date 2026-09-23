import { buildPageReadTool, PAGE_READ_TOOL_ID } from '@/lib/chat/context/page-read-tool';
import { putPageExtract, _resetPageStore } from '@/lib/chat/context/page-store';

jest.mock('@/lib/chat/context/summarize-page', () => ({
  answerFromPage: jest.fn(),
}));
import { answerFromPage } from '@/lib/chat/context/summarize-page';

const extract = { path: '/x', title: 'Settings', heading: 'Settings', text: 'Teams: 11.' };

beforeEach(() => { _resetPageStore(); jest.clearAllMocks(); });

describe('readCurrentPage', () => {
  it('is registered under the id the system prompt names', () => {
    expect(PAGE_READ_TOOL_ID).toBe('readCurrentPage');
    expect(buildPageReadTool()[PAGE_READ_TOOL_ID]).toBeDefined();
  });

  it('suspends before running — requireApproval is set', () => {
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    expect(tool.requireApproval).toBe(true);
  });

  it('answers from the stored extract', async () => {
    (answerFromPage as jest.Mock).mockResolvedValue('There are 11 teams.');
    putPageExtract('run-1', extract);
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'how many teams?' }, { runId: 'run-1' });
    expect(answerFromPage).toHaveBeenCalledWith(extract, 'how many teams?');
    expect(JSON.stringify(out)).toContain('There are 11 teams.');
  });

  it('resolves — does not throw — when no extract was supplied', async () => {
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'q' }, { runId: 'missing' });
    expect(JSON.stringify(out).toLowerCase()).toContain('unavailable');
    expect(answerFromPage).not.toHaveBeenCalled();
  });

  it('resolves when Haiku returns null', async () => {
    (answerFromPage as jest.Mock).mockResolvedValue(null);
    putPageExtract('run-2', extract);
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'q' }, { runId: 'run-2' });
    expect(JSON.stringify(out).toLowerCase()).toContain('could not read');
  });

  it('labels its answer as read from the screen, not fetched', async () => {
    (answerFromPage as jest.Mock).mockResolvedValue('Settings page.');
    putPageExtract('run-3', extract);
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'q' }, { runId: 'run-3' });
    expect(JSON.stringify(out).toLowerCase()).toContain('rendered page');
  });
});
