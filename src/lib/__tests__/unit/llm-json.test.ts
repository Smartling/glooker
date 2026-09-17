import {
  parseModelJson,
  stripTrailingCommas,
  stripJsonFences,
  ModelJsonError,
} from '@/lib/llm-json';

/**
 * GLOOK-54. The Top Projects card was broken for weeks by ONE character: the
 * model closed a `jira_keys` array, emitted `,`, then `}`. The real captured
 * bytes, from the app log:
 *
 *   …"RPS-10766","RPS-10768"],
 *           },
 *           {"name":"Video/Audio Processing", …
 */

const REAL_ARTIFACT = `{
  "projects": [
    {
      "name": "Media Studio",
      "jira_keys": ["RPS-10766","RPS-10768"],
    },
    {"name":"Video/Audio Processing", "jira_keys":["RPS-10683"]}
  ]
}`;

describe('the real 2026-09-16 artifact', () => {
  it('fails a plain JSON.parse with the signature we saw in production', () => {
    let msg = '';
    try { JSON.parse(REAL_ARTIFACT); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/Expected double-quoted property name/);
  });

  it('parses after repair, and says it repaired', () => {
    const { value, repaired } = parseModelJson<{ projects: any[] }>(REAL_ARTIFACT);
    expect(repaired).toBe(true);
    expect(value.projects).toHaveLength(2);
    expect(value.projects[0].jira_keys).toEqual(['RPS-10766', 'RPS-10768']);
  });
});

describe('stripTrailingCommas is literal-aware', () => {
  it('does NOT touch a comma-brace sequence inside a string', () => {
    // The payload is full of Jira summaries and commit messages. A naive
    // replace(/,\s*([}\]])/g, '$1') corrupts these silently, which is the whole
    // reason this scans literals instead of pattern-matching.
    const json = '{"summary":"refactor, } and cleanup, ] too","n":1}';
    expect(stripTrailingCommas(json)).toBe(json);
    expect(parseModelJson<any>(json).value.summary).toBe('refactor, } and cleanup, ] too');
  });

  it('survives an escaped quote before a comma-brace', () => {
    // `\"` must not read as the end of the literal, or the scanner loses track
    // of whether it is inside a string.
    const json = '{"msg":"he said \\"done, }\\" loudly","n":1}';
    expect(stripTrailingCommas(json)).toBe(json);
    expect(parseModelJson<any>(json).value.msg).toBe('he said "done, }" loudly');
  });

  it('handles a trailing backslash at the very end without overrunning', () => {
    expect(() => stripTrailingCommas('{"a":"b\\')).not.toThrow();
  });

  it('strips in objects and arrays, including nested and multiple', () => {
    expect(stripTrailingCommas('{"a":[1,2,],}')).toBe('{"a":[1,2],}'.replace(',}', '}'));
    expect(parseModelJson<any>('{"a":[1,2,],}').value).toEqual({ a: [1, 2] });
    expect(parseModelJson<any>('[{"a":1,},{"b":2,},]').value).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('keeps legitimate commas between members', () => {
    const json = '{"a":1,"b":2}';
    expect(stripTrailingCommas(json)).toBe(json);
  });

  it('preserves whitespace shape around a removed comma', () => {
    expect(parseModelJson<any>('{"a":1  ,  \n }').value).toEqual({ a: 1 });
  });
});

describe('well-formed output is never modified', () => {
  it('reports repaired=false and returns the parsed value', () => {
    const { value, repaired } = parseModelJson<any>('{"projects":[{"name":"x"}]}');
    expect(repaired).toBe(false);
    expect(value.projects[0].name).toBe('x');
  });

  it('strips provider code fences', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(parseModelJson<any>('```json\n{"a":1}\n```').value).toEqual({ a: 1 });
  });
});

describe('unrepairable output', () => {
  it('raises ModelJsonError carrying the diagnostic window', () => {
    // 'r' is the shape report c28781b4 failed with — prose, not a comma.
    const raw = 'reasoning: the projects are as follows {"projects":[]}';
    let err: ModelJsonError | null = null;
    try { parseModelJson(raw); } catch (e) { err = e as ModelJsonError; }
    expect(err).toBeInstanceOf(ModelJsonError);
    expect(err!.head).toContain('reasoning');
    expect(err!.tail).toContain('projects');
  });

  it('keeps model output OUT of err.message', () => {
    // route.ts serialises err.message into the 5xx body, and this payload
    // carries commit messages and Jira summaries.
    const secretish = '{"summary":"INTERNAL-COMMIT-TEXT", oops}';
    let err: ModelJsonError | null = null;
    try { parseModelJson(secretish); } catch (e) { err = e as ModelJsonError; }
    expect(err!.message).not.toContain('INTERNAL-COMMIT-TEXT');
    expect(err!.window).toContain('INTERNAL-COMMIT-TEXT'); // available for logs
  });

  it('reports a usable position for the log window', () => {
    let err: ModelJsonError | null = null;
    try { parseModelJson('{"a":1 "b":2}'); } catch (e) { err = e as ModelJsonError; }
    expect(err!.position).toBeGreaterThan(0);
  });
});
