import { answerFromPage, HAIKU_MODEL, HAIKU_MODEL_VERSION } from '@/lib/chat/context/summarize-page';

jest.mock('@/lib/smartling-auth', () => ({ getAccessToken: jest.fn().mockResolvedValue('tok') }));

const extract = { path: '/settings', title: 'Settings', heading: 'Settings', text: 'LLM provider: smartling. Teams: 11.' };

function mockFetchOnce(body: any, ok = true) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok, json: async () => body,
  });
}

beforeEach(() => jest.clearAllMocks());

describe('answerFromPage', () => {
  it('sends the model and version SPLIT, not combined', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [{ type: 'text', text: 'Settings page.' }] } } } });
    await answerFromPage(extract, 'what page is this?');
    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    expect(body.request.model).toBe(HAIKU_MODEL);
    expect(body.request.modelVersion).toBe(HAIKU_MODEL_VERSION);
    expect(HAIKU_MODEL).toBe('claude-haiku-4-5');
    expect(HAIKU_MODEL_VERSION).toBe('20251001');
  });

  it('returns the model text', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [{ type: 'text', text: 'Settings page.' }] } } } });
    await expect(answerFromPage(extract, 'what page?')).resolves.toBe('Settings page.');
  });

  it('includes the question and the page text in the prompt', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [{ type: 'text', text: 'x' }] } } } });
    await answerFromPage(extract, 'how many teams?');
    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    const sent = JSON.stringify(body.request.payload.messages);
    expect(sent).toContain('how many teams?');
    expect(sent).toContain('Teams: 11.');
  });

  it('returns null on a proxy error envelope rather than throwing', async () => {
    mockFetchOnce({ response: { errors: [{ message: 'nope' }] } });
    await expect(answerFromPage(extract, 'q')).resolves.toBeNull();
  });

  it('returns null when fetch rejects rather than throwing', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(answerFromPage(extract, 'q')).resolves.toBeNull();
  });

  it('returns null when the payload has no text content', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [] } } } });
    await expect(answerFromPage(extract, 'q')).resolves.toBeNull();
  });
});
