// PR #81 review: req.json() sat outside the handler's try, so a malformed body
// was an unhandled 500. It is the caller's error and now gets a 400.
jest.mock('@/lib/chat/agent', () => ({ runChatAgent: jest.fn() }));
jest.mock('@/lib/orgs/guard', () => ({ requireAllowedOrg: (org: string) => ({ ok: true, org }) }));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(async () => ({ githubLogin: 'test-user', isAdmin: false, authDisabled: false })),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/chat/route';
import { runChatAgent } from '@/lib/chat/agent';

const post = (body: string) => POST(new NextRequest('http://localhost/api/chat', {
  method: 'POST', body, headers: { 'content-type': 'application/json' },
}) as any);

it('answers 400 for a malformed JSON body, without running the agent', async () => {
  const res = await post('{not json');
  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toEqual({ error: 'request body must be JSON' });
  expect(runChatAgent).not.toHaveBeenCalled();
});

it('still validates a well-formed body', async () => {
  const res = await post(JSON.stringify({ org: 'acme', messages: [] }));
  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toEqual({ error: 'messages are required' });
});
