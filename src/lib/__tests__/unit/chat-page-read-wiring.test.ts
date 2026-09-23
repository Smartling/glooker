import { CHAT_SYSTEM } from '@/lib/chat/engines/types';
import { PAGE_READ_TOOL_ID } from '@/lib/chat/context/page-read-tool';

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
