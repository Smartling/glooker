import { createMockCcSpendProvider } from '@/lib/cc-spend/mock-provider';
import { seedCcSkillsUsage, seedCcModelUsage } from '../../../../scripts/seed-data';

it('mock provider returns deterministic skills usage per email', async () => {
  const p = createMockCcSpendProvider();
  const a = await p.pullSkillsByPeriod('2026-07-01', '2026-07-14');
  const b = await p.pullSkillsByPeriod('2026-07-01', '2026-07-14');
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(0);
  expect(a[0].products.length).toBeGreaterThan(0);
  for (const e of a) {
    for (const prod of e.products) {
      expect(prod.used + prod.distinct).toBeGreaterThan(0);
    }
  }
});

it('mock provider returns deterministic model usage per email', async () => {
  const p = createMockCcSpendProvider();
  const a = await p.pullModelCostByPeriod('2026-07-01', '2026-07-14');
  expect(a).toEqual(await p.pullModelCostByPeriod('2026-07-01', '2026-07-14'));
  expect(a[0].models.map(m => m.model)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
});

it('seed data covers both breakdown tables', () => {
  expect(seedCcSkillsUsage.length).toBeGreaterThan(0);
  expect(seedCcModelUsage.length).toBeGreaterThan(0);
  for (const r of seedCcSkillsUsage) {
    expect(r).toHaveProperty('report_id');
    expect(r).toHaveProperty('github_login');
    expect(r).toHaveProperty('product');
  }
  for (const r of seedCcModelUsage) {
    expect(r).toHaveProperty('model');
    expect(r).toHaveProperty('cost');
  }
});

it('seeded cc_skills_used equals the sum of that developer seed rows', () => {
  const { seedDeveloperStats } = require('../../../../scripts/seed-data');
  for (const dev of seedDeveloperStats) {
    const expected = seedCcSkillsUsage
      .filter((r: any) => r.report_id === dev.report_id && r.github_login === dev.github_login)
      .reduce((s: number, r: any) => s + r.skills_used, 0);
    expect(dev.cc_skills_used).toBe(expected);
  }
});
