import { extractSkillsEntries } from '@/lib/cc-spend/skills-parser';

it('names products by dotted path with the _metrics suffix stripped', () => {
  const row = {
    user: { email_address: 'a@x.com' },
    chat_metrics: { distinct_skills_used_count: 3, message_count: 10 },
    cowork_metrics: { skills_used_count: 12, distinct_skills_used_count: 4 },
    office_metrics: {
      excel: { skills_used_count: 2, distinct_skills_used_count: 1 },
      word:  { skills_used_count: 0, distinct_skills_used_count: 0 },
    },
    science_metrics: { skills_used_count: 7 },
  };
  const out = extractSkillsEntries(row);
  expect(out).toEqual(expect.arrayContaining([
    { product: 'chat',         used: 0,  distinct: 3 },
    { product: 'cowork',       used: 12, distinct: 4 },
    { product: 'office.excel', used: 2,  distinct: 1 },
    { product: 'science',      used: 7,  distinct: 0 },
  ]));
});

it('skips entries where both counts are zero', () => {
  const out = extractSkillsEntries({
    office_metrics: { word: { skills_used_count: 0, distinct_skills_used_count: 0 } },
  });
  expect(out).toEqual([]);
});

it('picks up an unknown future product bucket with no code change', () => {
  const out = extractSkillsEntries({ hologram_metrics: { skills_used_count: 9 } });
  expect(out).toEqual([{ product: 'hologram', used: 9, distinct: 0 }]);
});

it('ignores nodes with no skills fields, including user', () => {
  const out = extractSkillsEntries({
    user: { type: 'user', id: 'u1', email_address: 'a@x.com' },
    claude_code_metrics: { core_metrics: { distinct_session_count: 45 } },
    web_search_count: 3,
  });
  expect(out).toEqual([]);
});

it('is safe on null, undefined and non-objects', () => {
  expect(extractSkillsEntries(null)).toEqual([]);
  expect(extractSkillsEntries(undefined)).toEqual([]);
  expect(extractSkillsEntries({})).toEqual([]);
});
