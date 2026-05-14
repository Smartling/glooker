import { createMockCcSpendProvider } from '@/lib/cc-spend/mock-provider';
import { getCcSpendProvider, __resetCcSpendProviderForTest } from '@/lib/cc-spend/provider';
import { MOCK_DEVELOPERS } from '../../../../scripts/mock-identities';

const originalProvider = process.env.CC_ANALYTICS_PROVIDER;

describe('MockCcSpendProvider', () => {
  it('returns an aggregate per MOCK_DEVELOPER with jiraEmail', async () => {
    const provider = createMockCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    const expected = MOCK_DEVELOPERS.filter(d => d.jiraEmail).length;
    expect(result.length).toBe(expected);
    for (const agg of result) {
      expect(agg.email).toMatch(/@/);
      expect(agg.costCents).toBeGreaterThanOrEqual(20000);
      expect(agg.costCents).toBeLessThanOrEqual(120000);
      expect(agg.requests).toBeGreaterThanOrEqual(100);
      expect(agg.requests).toBeLessThanOrEqual(10000);
    }
  });

  it('is deterministic — same period yields same values', async () => {
    const provider = createMockCcSpendProvider();
    const a = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    const b = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect(a).toEqual(b);
  });

  it('probe returns user count + sample email', async () => {
    const provider = createMockCcSpendProvider();
    const probe = await provider.probe('2026-04-15');
    const expected = MOCK_DEVELOPERS.filter(d => d.jiraEmail).length;
    expect(probe.userCount).toBe(expected);
    expect(probe.sampleEmail).toMatch(/@/);
  });
});

describe('getCcSpendProvider factory', () => {
  afterEach(() => {
    __resetCcSpendProviderForTest();
    if (originalProvider === undefined) delete process.env.CC_ANALYTICS_PROVIDER;
    else process.env.CC_ANALYTICS_PROVIDER = originalProvider;
  });

  it('returns the mock provider when CC_ANALYTICS_PROVIDER=mock', async () => {
    process.env.CC_ANALYTICS_PROVIDER = 'mock';
    const provider = getCcSpendProvider();
    // Mock provider doesn't need the Anthropic env var.
    delete process.env.ANTHROPIC_ANALYTICS_API_KEY;
    const probe = await provider.probe('2026-04-15');
    expect(probe.userCount).toBeGreaterThan(0);
  });

  it('returns the Anthropic provider by default', () => {
    delete process.env.CC_ANALYTICS_PROVIDER;
    process.env.ANTHROPIC_ANALYTICS_API_KEY = 'sk-ant-analytics-test';
    const provider = getCcSpendProvider();
    expect(typeof provider.pullByPeriod).toBe('function');
    expect(typeof provider.probe).toBe('function');
  });

  it('caches the provider across calls until reset', () => {
    process.env.CC_ANALYTICS_PROVIDER = 'mock';
    const a = getCcSpendProvider();
    const b = getCcSpendProvider();
    expect(a).toBe(b);
    __resetCcSpendProviderForTest();
    const c = getCcSpendProvider();
    expect(c).not.toBe(a);
  });
});
