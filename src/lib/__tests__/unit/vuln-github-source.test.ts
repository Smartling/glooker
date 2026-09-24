jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
import {
  __setOctokitForTest, listOrgDependabotAlerts, listOrgRepoProperties, listOrgReposForVulns,
  getRepoDependabotStatus, ARCHIVED_ALERTS_MESSAGE, DEPENDABOT_OFF_MESSAGE, bmpOnly, VULN_GITHUB_TIMEOUT_MS,
} from '@/lib/github';
import { DEFAULT_PROPERTY_KEYS } from '@/lib/vulnerabilities/config';

const alertPayload = (n: number, over: any = {}) => ({
  number: n, state: 'open', html_url: `https://github.com/o/r/security/dependabot/${n}`,
  created_at: '2026-09-22T14:41:09Z', updated_at: '2026-09-22T14:41:09Z',
  fixed_at: null, dismissed_at: null, auto_dismissed_at: null, dismissed_reason: null,
  repository: { id: 42, full_name: 'o/r' },
  dependency: { package: { ecosystem: 'npm', name: 'example-package' }, manifest_path: 'pnpm-lock.yaml', relationship: 'transitive', scope: 'runtime' },
  security_advisory: { ghsa_id: 'GHSA-1', cve_id: 'CVE-1', summary: 's', severity: 'critical', cvss: { score: 9.8 }, epss: { percentage: 0.00866 }, withdrawn_at: null },
  security_vulnerability: { first_patched_version: null },
  ...over,
});

function httpError(status: number, message: string, headers: Record<string, string> = {}) {
  return Object.assign(new Error(message), { status, response: { status, headers, data: { message } } });
}

beforeEach(() => jest.useRealTimers());

it('follows Link rel=next and normalises every alert', async () => {
  const request = jest.fn()
    .mockResolvedValueOnce({ data: [alertPayload(1)], headers: { link: '<https://api.github.com/organizations/1/dependabot/alerts?after=abc>; rel="next"' } })
    .mockResolvedValueOnce({ data: [alertPayload(2, { state: 'auto_dismissed', auto_dismissed_at: '2026-09-23T00:00:00.500Z' })], headers: {} });
  __setOctokitForTest({ request });
  const alerts = await listOrgDependabotAlerts('o');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][0]).toBe('GET /orgs/{org}/dependabot/alerts');
  expect(request.mock.calls[0][1]).toMatchObject({ org: 'o', severity: 'critical,high', state: 'open,fixed,dismissed,auto_dismissed', per_page: 100 });
  expect(request.mock.calls[1][0]).toBe('GET https://api.github.com/organizations/1/dependabot/alerts?after=abc');
  expect(alerts[0]).toMatchObject({ repoId: 42, repoFullName: 'o/r', number: 1, severity: 'critical', cvssScore: 9.8, epssPercentage: 0.00866, scope: 'runtime', packageName: 'example-package' });
  expect(alerts[1]).toMatchObject({ state: 'auto_dismissed', autoDismissedAt: '2026-09-23T00:00:00Z' });
  // fetchAllPages maps per page, so the raw GitHub
  // shape (with its nested `repository` object) is never held onto.
  expect(alerts[0]).not.toHaveProperty('repository');
  expect(alerts[1]).not.toHaveProperty('repository');
});

it('logs page-progress every 20 pages, naming the route template (never the full URL)', async () => {
  const request = jest.fn();
  for (let i = 1; i <= 20; i++) {
    const hasNext = i < 20;
    request.mockResolvedValueOnce({
      data: [alertPayload(i)],
      headers: hasNext ? { link: `<https://api.github.com/x?page=${i + 1}>; rel="next"` } : {},
    });
  }
  __setOctokitForTest({ request });
  const log = jest.fn();
  await listOrgDependabotAlerts('o', log);
  expect(log).toHaveBeenCalledWith('GET /orgs/{org}/dependabot/alerts: page 20, 20 items');
  expect(log.mock.calls.some(c => String(c[0]).includes('api.github.com'))).toBe(false); // never the full URL
});

it('drops an alert whose severity is neither critical nor high, and logs the count (belt-and-suspenders on the server-side filter)', async () => {
  const request = jest.fn().mockResolvedValue({
    data: [alertPayload(1), alertPayload(2, { security_advisory: { ...alertPayload(2).security_advisory, severity: 'medium' } })],
    headers: {},
  });
  __setOctokitForTest({ request });
  const log = jest.fn();
  const alerts = await listOrgDependabotAlerts('o', log);
  expect(alerts.map(a => a.number)).toEqual([1]);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('skipped 1 alert'));
});

it('retries only the failing page on a 5xx', async () => {
  const request = jest.fn()
    .mockResolvedValueOnce({ data: [alertPayload(1)], headers: { link: '<https://api.github.com/x?after=p2>; rel="next"' } })
    .mockRejectedValueOnce(httpError(502, 'Bad gateway'))
    .mockResolvedValueOnce({ data: [alertPayload(2)], headers: {} });
  __setOctokitForTest({ request });
  const alerts = await listOrgDependabotAlerts('o');
  expect(alerts.map(a => a.number)).toEqual([1, 2]);
  // page 1 once, page 2 twice (failed + retried). Page 1 was NOT refetched.
  expect(request.mock.calls.map(c => c[0])).toEqual([
    'GET /orgs/{org}/dependabot/alerts', 'GET https://api.github.com/x?after=p2', 'GET https://api.github.com/x?after=p2',
  ]);
}, 15000);

it('propagates a permission 403 immediately', async () => {
  const request = jest.fn().mockRejectedValue(httpError(403, 'Resource not accessible by personal access token', { 'x-ratelimit-remaining': '4999' }));
  __setOctokitForTest({ request });
  await expect(listOrgDependabotAlerts('o')).rejects.toMatchObject({ status: 403 });
  expect(request).toHaveBeenCalledTimes(1);
});

it('truncates fields exceeding their column limits (a 600-char manifest_path comes back as 500) and logs the count', async () => {
  const request = jest.fn().mockResolvedValue({
    data: [alertPayload(1, { dependency: { ...alertPayload(1).dependency, manifest_path: 'x'.repeat(600) } })],
    headers: {},
  });
  __setOctokitForTest({ request });
  const log = jest.fn();
  const alerts = await listOrgDependabotAlerts('o', log);
  expect(alerts[0].manifestPath).toHaveLength(500);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('clipped 1 field'));
});

it('mapAlert reads first_patched_version.identifier', async () => {
  const request = jest.fn().mockResolvedValue({
    data: [alertPayload(1, { security_vulnerability: { first_patched_version: { identifier: '1.2.3' } } })],
    headers: {},
  });
  __setOctokitForTest({ request });
  const alerts = await listOrgDependabotAlerts('o');
  expect(alerts[0].firstPatchedVersion).toBe('1.2.3');
});

it('listOrgReposForVulns maps archived', async () => {
  const request = jest.fn().mockResolvedValue({
    data: [{ id: 1, full_name: 'o/live', archived: false }, { id: 2, full_name: 'o/dead', archived: true }],
    headers: {},
  });
  __setOctokitForTest({ request });
  expect(await listOrgReposForVulns('o')).toEqual([
    { repoId: 1, fullName: 'o/live', archived: false },
    { repoId: 2, fullName: 'o/dead', archived: true },
  ]);
});

it('maps custom property values by the configured keys and reports which keys were seen', async () => {
  const request = jest.fn().mockResolvedValue({ data: [
    { repository_id: 42, repository_full_name: 'o/r', properties: [
      { property_name: 'team', value: 'TeamA' }, { property_name: 'service_tier', value: 'production' },
      { property_name: 'codebase_type', value: null }, { property_name: 'unrelated', value: 'x' },
    ] },
  ], headers: {} });
  __setOctokitForTest({ request });
  const result = await listOrgRepoProperties('o', DEFAULT_PROPERTY_KEYS);
  expect(result.rows).toEqual([{ repoId: 42, fullName: 'o/r', team: 'TeamA', serviceTier: 'production', codebaseType: null }]);
  expect(result.keysSeen).toEqual({ team: true, tier: true, codebase: true });
});

describe('getRepoDependabotStatus', () => {
  it('200 → ok', async () => {
    __setOctokitForTest({ request: jest.fn().mockResolvedValue({ data: [], headers: {} }) });
    expect(await getRepoDependabotStatus('o/r')).toEqual({ status: 'ok' });
  });
  it('pinned archived message → archived', async () => {
    __setOctokitForTest({ request: jest.fn().mockRejectedValue(httpError(403, ARCHIVED_ALERTS_MESSAGE)) });
    expect(await getRepoDependabotStatus('o/r')).toEqual({ status: 'archived' });
  });
  it('anything else → error with the detail', async () => {
    __setOctokitForTest({ request: jest.fn().mockRejectedValue(httpError(403, 'Some other 403 message')) });
    expect(await getRepoDependabotStatus('o/r')).toEqual({ status: 'error', detail: 'HTTP 403: Some other 403 message' });
  });
  it('pinned dependabot-off message → dependabot-off, with the raw message as detail', async () => {
    __setOctokitForTest({ request: jest.fn().mockRejectedValue(httpError(403, DEPENDABOT_OFF_MESSAGE)) });
    expect(await getRepoDependabotStatus('o/r')).toEqual({ status: 'dependabot-off', detail: DEPENDABOT_OFF_MESSAGE });
  });
});

// a utf8mb3 MySQL database (dev's) rejects any 4-byte UTF-8 character (an
// emoji) in a TEXT column with ERROR 1366, rolling back the whole daily sync. bmpOnly() replaces
// every code point above U+FFFF with U+FFFD before clip() ever runs, so a 4-byte character can
// never reach the DB and clip can't split its surrogate pair either.
it('bmpOnly replaces a 4-byte character (surrogate pair) with U+FFFD and reports it was sanitized', () => {
  const onSanitize = jest.fn();
  expect(bmpOnly('🚀 rocket', onSanitize)).toBe('� rocket');
  expect(onSanitize).toHaveBeenCalledTimes(1);
  const onSanitize2 = jest.fn();
  expect(bmpOnly('plain ascii', onSanitize2)).toBe('plain ascii');
  expect(onSanitize2).not.toHaveBeenCalled();
  expect(bmpOnly(null, jest.fn())).toBeNull();
});

it('an emoji in an alert summary comes back as U+FFFD, and the sanitized count reaches onDataNotice', async () => {
  const request = jest.fn().mockResolvedValue({
    data: [alertPayload(1, { security_advisory: { ...alertPayload(1).security_advisory, summary: '🚀 rocket vuln' } })],
    headers: {},
  });
  __setOctokitForTest({ request });
  const onDataNotice = jest.fn();
  const alerts = await listOrgDependabotAlerts('o', undefined, onDataNotice);
  expect(alerts[0].summary).toBe('� rocket vuln');
  expect(onDataNotice).toHaveBeenCalledWith('sanitized', 1);
});

it('an emoji in a repo property team value comes back as U+FFFD', async () => {
  const request = jest.fn().mockResolvedValue({ data: [
    { repository_id: 42, repository_full_name: 'o/r', properties: [{ property_name: 'team', value: '🚀 Team' }] },
  ], headers: {} });
  __setOctokitForTest({ request });
  const onDataNotice = jest.fn();
  const result = await listOrgRepoProperties('o', DEFAULT_PROPERTY_KEYS, undefined, onDataNotice);
  expect(result.rows[0].team).toBe('� Team');
  expect(onDataNotice).toHaveBeenCalledWith('sanitized', 1);
});

it('a 600-char manifest_path whose raw cut point falls inside a surrogate pair ends up 500 chars with no lone surrogate', async () => {
  // Without bmpOnly, slicing at raw index 500 would split the 🚀 emoji's surrogate pair
  // (it occupies raw UTF-16 units 499-500), leaving a lone high surrogate at the end.
  const manifestPath = 'x'.repeat(499) + '🚀' + 'x'.repeat(100); // 601 raw UTF-16 units
  const request = jest.fn().mockResolvedValue({
    data: [alertPayload(1, { dependency: { ...alertPayload(1).dependency, manifest_path: manifestPath } })],
    headers: {},
  });
  __setOctokitForTest({ request });
  const alerts = await listOrgDependabotAlerts('o');
  expect(alerts[0].manifestPath).toHaveLength(500);
  expect(alerts[0].manifestPath!.endsWith('�')).toBe(true);
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(alerts[0].manifestPath!)).toBe(false);
});

// A hung request (no response, no error) has
// no status and no rate-limit header, so it would otherwise wait forever, keeping the in-process
// sync flag set until the process restarts. AbortSignal.timeout isn't driven by Jest's fake
// timers, so this test replaces it with a manually-controlled AbortController instead of waiting
// out the real 60s. The rejection's `name` is `TimeoutError` (not `AbortError` — that name is
// reserved for an explicit `controller.abort()` call) and carries `status: 500`, the shape
// @octokit/request's fetch wrapper actually produces for a real timeout (verified against
// dist-src/fetch-wrapper.js: it only special-cases the literal name `AbortError`; anything else,
// including `TimeoutError`, falls through to the generic `RequestError(message, 500, …)` branch).
// withRetry must therefore classify this as a transient 5xx and retry it, not propagate
// immediately — fake timers stand in for the real 1s/2s/4s backoff between attempts.
it('a request that never resolves times out with status 500, and withRetry retries it before the run finally fails', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  try {
    const request = jest.fn((_route: string, opts: any) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        const err: any = new Error('The user aborted a request.');
        err.name = 'TimeoutError';
        err.status = 500;
        reject(err);
      };
      if (opts.request?.signal?.aborted) onAbort();
      else opts.request?.signal?.addEventListener('abort', onAbort);
    }));
    __setOctokitForTest({ request });
    const promise = listOrgReposForVulns('o');
    promise.catch(() => {}); // the retry loop below rejects long before the `.rejects` assertion attaches; suppress the transient unhandled-rejection warning
    controller.abort(); // first attempt times out
    await jest.advanceTimersByTimeAsync(1000); // transient backoff #1, then attempt 2 (already-aborted signal) fails immediately
    await jest.advanceTimersByTimeAsync(2000); // transient backoff #2, then attempt 3 fails immediately
    await jest.advanceTimersByTimeAsync(4000); // transient backoff #3, then attempt 4 fails immediately and exhausts the budget
    await expect(promise).rejects.toMatchObject({ status: 500 });
    expect(request.mock.calls.length).toBeGreaterThan(1); // withRetry actually retried, not just failed once
    expect(timeoutSpy).toHaveBeenCalledWith(VULN_GITHUB_TIMEOUT_MS);
    expect(request.mock.calls[0][1]).toMatchObject({ org: 'o' });
  } finally {
    timeoutSpy.mockRestore();
    jest.useRealTimers();
  }
});
