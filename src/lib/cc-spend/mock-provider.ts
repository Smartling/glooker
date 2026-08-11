import type { CcSpendProvider, PerEmailAggregate, CcSpendProbeResult, PerEmailSkills, PerEmailModelCost } from './provider';
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

const MOCK_PRODUCTS = ['cowork', 'chat', 'office.excel', 'science'] as const;
const MOCK_MODELS = ['claude-opus-4-8', 'claude-sonnet-5'] as const;

function skillsFor(email: string): PerEmailSkills {
  const h = hashEmail(email);
  const products = MOCK_PRODUCTS
    .map((product, i) => {
      const used = (h >>> (i * 3)) % 25;          // 0–24
      const distinct = used === 0 ? 0 : 1 + (used % 5);
      // chat reports no total, mirroring the real API.
      return product === 'chat'
        ? { product, used: 0, distinct: used === 0 ? 0 : 1 + (used % 4) }
        : { product, used, distinct };
    })
    .filter(p => p.used > 0 || p.distinct > 0);
  return { email, products };
}

function modelsFor(email: string): PerEmailModelCost {
  const h = hashEmail(email);
  return {
    email,
    models: MOCK_MODELS.map((model, i) => ({
      model,
      costCents: 5000 + ((h >>> (i * 5)) % 60000),
      requests: 50 + ((h >>> (i * 7)) % 900),
    })),
  };
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

  async function pullSkillsByPeriod(): Promise<PerEmailSkills[]> {
    return MOCK_DEVELOPERS.filter(d => d.jiraEmail).map(d => skillsFor(d.jiraEmail));
  }

  async function pullModelCostByPeriod(): Promise<PerEmailModelCost[]> {
    return MOCK_DEVELOPERS.filter(d => d.jiraEmail).map(d => modelsFor(d.jiraEmail));
  }

  return { pullByPeriod, probe, pullSkillsByPeriod, pullModelCostByPeriod };
}
