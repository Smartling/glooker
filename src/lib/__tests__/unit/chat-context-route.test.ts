import { buildPreamble } from '@/lib/chat/context/preamble';
import { CHAT_SYSTEM } from '@/lib/chat/engines/types';
import type { PageContext } from '@/lib/chat/context/types';

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
