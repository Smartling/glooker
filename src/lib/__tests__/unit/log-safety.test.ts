import { logSafe } from '@/lib/logger';
import { loadPrompt } from '@/lib/prompt-loader';

// Built from escapes rather than literals: U+2028/U+2029 are line terminators in
// JS source, so embedding them raw makes this file fail to parse.
const ESC = '\u001b';
const LS = '\u2028';
const PS = '\u2029';

describe('logSafe — log injection', () => {
  // Five console.error sites interpolated the raw [key] route segment, three of
  // them on unauthenticated routes, and the segment arrives URL-decoded.
  it('collapses CR/LF so a value cannot forge log lines', () => {
    const payload = 'X-1\n2026-10-02T00:00:00Z INFO auth: admin@corp.example signed in';
    const out = logSafe(payload);
    expect(out).not.toContain('\n');
    expect(out).not.toContain('\r');
    expect(out.split('\n')).toHaveLength(1);
  });

  it('handles CRLF and the Unicode line/paragraph separators too', () => {
    for (const sep of ['\r\n', '\r', '\n', LS, PS]) {
      expect(logSafe(`a${sep}b`)).not.toMatch(/[\r\n\u2028\u2029]/);
    }
  });

  it('strips ANSI escapes and other control characters', () => {
    expect(logSafe(`${ESC}[31mred${ESC}[0m`)).toBe('[31mred[0m');
    expect(logSafe('a\u0008b\u000bc')).toBe('abc');
    expect(logSafe('a\u007fb')).toBe('ab');
  });

  it('caps length', () => {
    expect(logSafe('x'.repeat(500)).length).toBe(120);
    expect(logSafe('x'.repeat(500), 10).length).toBe(10);
  });

  it('leaves ordinary text intact and renders nullish as empty', () => {
    expect(logSafe('GLOOK-60 failed')).toBe('GLOOK-60 failed');
    expect(logSafe(null)).toBe('');
    expect(logSafe(undefined)).toBe('');
  });
});

describe('prompt-loader containment', () => {
  it('refuses a filename that escapes PROMPTS_DIR', () => {
    for (const f of ['../package.json', '../../etc/passwd', '/etc/passwd']) {
      expect(() => loadPrompt(f)).toThrow(/escapes PROMPTS_DIR|not found/);
    }
  });

  it('still loads a legitimate template', () => {
    expect(loadPrompt('analyzer-system.txt')).toContain('{{COMPLEXITY_CALIBRATION}}');
  });

  it('does not disclose the resolved absolute path on a miss', () => {
    try {
      loadPrompt('definitely-missing.txt');
      throw new Error('expected a throw');
    } catch (err) {
      const m = (err as Error).message;
      expect(m).toContain('definitely-missing.txt');
      expect(m).not.toContain('/Users');
      expect(m).not.toContain('/app/prompts');
    }
  });
});
