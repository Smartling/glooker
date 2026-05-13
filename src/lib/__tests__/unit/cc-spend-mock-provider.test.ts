import { createMockCcSpendProvider } from '@/lib/cc-spend/mock-provider';
import { MOCK_DEVELOPERS } from '../../../../scripts/mock-identities';

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
      expect(agg.sessions).toBeGreaterThanOrEqual(5);
      expect(agg.sessions).toBeLessThanOrEqual(50);
      expect(agg.inputTokens).toBeGreaterThan(0);
      expect(agg.outputTokens).toBeGreaterThan(0);
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
