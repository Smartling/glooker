import { aggregateTeams } from '@/lib/teams/team-aggregator';

const teams = [{ id: 't1', name: 'A', color: '#111', members: ['alice', 'bob'] }];

it('team total is null when any member cost is hidden', () => {
  const devs = [
    { github_login: 'alice', cc_total_cost: 100 },
    { github_login: 'bob' },  // cost hidden (stripped)
  ] as any;
  const [row] = aggregateTeams(devs, teams as any);
  expect(row.cc_total_cost).toBeNull();
});

it('team total is the real sum when all members visible', () => {
  const devs = [
    { github_login: 'alice', cc_total_cost: 100 },
    { github_login: 'bob', cc_total_cost: 50 },
  ] as any;
  const [row] = aggregateTeams(devs, teams as any);
  expect(row.cc_total_cost).toBe(150);
});
