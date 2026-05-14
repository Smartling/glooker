import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult } from './provider';
import { MOCK_DEVELOPERS } from '../../../scripts/mock-identities';

function hashEmail(email: string): number {
  let h = 2166136261;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function aggregateFor(email: string): PerEmailAggregate {
  const h = hashEmail(email);
  const costCents = 20000 + (h % 100000);
  // 100–10000 requests, matching the realistic per-user volume the Analytics API returns.
  const requests = 100 + (h % 9900);
  return { email, costCents, requests };
}

export function createMockCcSpendProvider(): CcSpendProvider {
  async function pullByPeriod(): Promise<PerEmailAggregate[]> {
    return MOCK_DEVELOPERS
      .filter(d => d.jiraEmail)
      .map(d => aggregateFor(d.jiraEmail));
  }

  async function probe(): Promise<CcSpendProbeResult> {
    const developers = MOCK_DEVELOPERS.filter(d => d.jiraEmail);
    return {
      userCount: developers.length,
      sampleEmail: developers[0]?.jiraEmail,
    };
  }

  return { pullByPeriod, probe };
}
