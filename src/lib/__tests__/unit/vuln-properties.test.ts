import { mapPropertyRows } from '@/lib/vulnerabilities/properties';

const keys = { team: 'owner', tier: 'tier', codebase: 'kind' };

it('maps configured keys to the internal fields and reports which keys were seen', () => {
  const r = mapPropertyRows([
    { repoId: 1, fullName: 'your-org/a', properties: [{ property_name: 'owner', value: 'Team A' }, { property_name: 'tier', value: 'live' }] },
    { repoId: 2, fullName: 'your-org/b', properties: [{ property_name: 'unrelated', value: 'x' }] },
  ], keys);
  expect(r.rows[0]).toEqual({ repoId: 1, fullName: 'your-org/a', team: 'Team A', serviceTier: 'live', codebaseType: null });
  expect(r.rows[1]).toMatchObject({ team: null, serviceTier: null, codebaseType: null });
  expect(r.keysSeen).toEqual({ team: true, tier: true, codebase: false });
});

it('a non-string or empty value maps to null but still counts as the key being seen', () => {
  const r = mapPropertyRows([{ repoId: 1, fullName: 'your-org/a', properties: [{ property_name: 'kind', value: '' }] }], keys);
  expect(r.rows[0].codebaseType).toBeNull();
  expect(r.keysSeen.codebase).toBe(true);
});
