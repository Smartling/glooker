/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import ChatPanel from '@/app/chat-panel';

// ChatPanel pulls in usePageContext/usePageSuggestions, which import
// usePathname/useParams/useSearchParams from next/navigation. Those hooks
// throw outside a Next.js router context, so — same factory-mock pattern
// CLAUDE.md documents for @octokit/rest — this must be mocked before the
// import above resolves. A pathname that matches no registry entry keeps
// usePageContext() returning null, so no page-context chip complicates
// these assertions.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/chat-panel-test-harness',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(''),
}));

function jsonResponse(body: unknown) {
  return { json: async () => body };
}

async function openPanelAndSend(message: string) {
  fireEvent.click(screen.getByTitle('Ask Glooker'));
  const input = await screen.findByPlaceholderText('Ask about your team...');
  fireEvent.change(input, { target: { value: message } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('ChatPanel — automatic page-read wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Regression test for the Critical: send()'s handler used to call
  // providePage() BEFORE appending the initial response with a plain
  // `setMessages([...newMessages, ...])`, which overwrote whatever
  // providePage had already appended. The resolved answer was silently
  // discarded and every page-read turn ended on the "Reading the page…"
  // placeholder. This must fail against the pre-fix ordering.
  it('appends the resolved page-read answer as the LAST assistant message', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          response: 'Reading the page…',
          pendingPageRead: { runId: 'r1', toolCallId: 't1', question: 'what page?' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ response: 'This is the Settings page.' }));
    (global as any).fetch = fetchMock;

    render(<ChatPanel org="acme" />);
    await openPanelAndSend('What page is this?');

    const settingsMsg = await screen.findByText('This is the Settings page.');
    const readingMsg = screen.getByText('Reading the page…');

    // settingsMsg must occur AFTER readingMsg in document order — i.e. it
    // is the later (last) assistant message, not clobbered by it.
    // eslint-disable-next-line no-bitwise
    expect(readingMsg.compareDocumentPosition(settingsMsg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps recursive page reads at depth 3 instead of recursing forever', async () => {
    let calls = 0;
    const fetchMock = jest.fn(() => {
      calls += 1;
      return Promise.resolve(
        jsonResponse({
          response: `still reading (${calls})`,
          pendingPageRead: { runId: 'r', toolCallId: `t${calls}`, question: 'q' },
        }),
      );
    });
    (global as any).fetch = fetchMock;

    render(<ChatPanel org="acme" />);
    await openPanelAndSend('Keep asking forever?');

    expect(
      await screen.findByText(
        'The page was read several times without resolving the question. Please rephrase or ask again.',
      ),
    ).toBeTruthy();

    // 1 call from send() (depth-independent) + 4 calls from providePage at
    // depth 0, 1, 2, 3 (each still returning a pendingPageRead) before the
    // cap stops further recursion without a 6th call.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('shows the "Reading the page…" indicator only while a providePage call is in flight', async () => {
    let releaseSecondCall!: (v: unknown) => void;
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          response: 'Let me check the page.',
          pendingPageRead: { runId: 'r1', toolCallId: 't1', question: 'q' },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseSecondCall = resolve;
          }),
      );
    (global as any).fetch = fetchMock;

    render(<ChatPanel org="acme" />);
    await openPanelAndSend('What is on this page?');

    await screen.findByText('Let me check the page.');
    expect(await screen.findByText('Reading the page…')).toBeTruthy();

    await act(async () => {
      releaseSecondCall(jsonResponse({ response: 'Done reading.' }));
      await Promise.resolve();
    });

    expect(await screen.findByText('Done reading.')).toBeTruthy();
    expect(screen.queryByText('Reading the page…')).toBeNull();
  });
});
