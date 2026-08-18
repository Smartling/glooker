/**
 * Enforcement: every MySQL date expression written in src/lib SQL must have a
 * translateSQL rule.
 *
 * GLOOK-41 shipped because nothing connected "someone wrote DATE_ADD" to "the
 * SQLite translator knows DATE_ADD". The mocked suites around the caller never
 * reach translateSQL, so CI stayed green and the gap surfaced as a 500. This
 * test closes that loop: a new unhandled form fails here instead.
 */
import fs from 'fs';
import path from 'path';
import { translateSQL } from '@/lib/db/sqlite';

const LIB = path.join(process.cwd(), 'src', 'lib');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full);
    return e.isFile() && full.endsWith('.ts') && !full.endsWith('db/sqlite.ts') ? [full] : [];
  });
}

describe('MySQL date expressions in src/lib SQL', () => {
  it('are all handled by translateSQL', () => {
    const pattern = /DATE_ADD\s*\([^)]*INTERVAL[^)]*\)|DATE_SUB\s*\([^)]*INTERVAL[^)]*\)/gi;
    const offenders: string[] = [];

    for (const file of walk(LIB)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const expr of src.match(pattern) ?? []) {
        // Wrap in a minimal statement so translateSQL sees realistic input.
        try {
          translateSQL(`SELECT 1 WHERE x < ${expr}`);
        } catch {
          offenders.push(`${path.relative(process.cwd(), file)}: ${expr}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
