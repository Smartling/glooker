import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-loader-test-'));

  fs.writeFileSync(path.join(tmpDir, 'simple.txt'), 'Hello, world!');
  fs.writeFileSync(path.join(tmpDir, 'with-vars.txt'), 'Hello, {{NAME}}! You are {{AGE}} years old.');
  fs.writeFileSync(path.join(tmpDir, 'outer.txt'), 'Outer start\n{{INNER}}\nOuter end');
  fs.writeFileSync(path.join(tmpDir, 'inner.txt'), 'Inner content with {{VALUE}}');
  fs.writeFileSync(path.join(tmpDir, 'unreplaced.txt'), 'Hello, {{NAME}}! Missing: {{MISSING}}');
  fs.writeFileSync(path.join(tmpDir, 'cached.txt'), 'original content');

  process.env.PROMPTS_DIR = tmpDir;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true });
  delete process.env.PROMPTS_DIR;
});

describe('prompt-loader', () => {
  let loadPrompt: (filename: string, vars?: Record<string, string>) => string;
  let clearPromptCache: () => void;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('@/lib/prompt-loader');
    loadPrompt = mod.loadPrompt;
    clearPromptCache = mod.clearPromptCache;
  });

  it('loads a simple text file', () => {
    const result = loadPrompt('simple.txt');
    expect(result).toBe('Hello, world!');
  });

  it('substitutes {{PLACEHOLDER}} variables', () => {
    const result = loadPrompt('with-vars.txt', { NAME: 'Alice', AGE: '30' });
    expect(result).toBe('Hello, Alice! You are 30 years old.');
  });

  it('supports nested template inclusion via variables', () => {
    const inner = loadPrompt('inner.txt', { VALUE: 'dynamic' });
    const result = loadPrompt('outer.txt', { INNER: inner });
    expect(result).toBe('Outer start\nInner content with dynamic\nOuter end');
  });

  it('leaves unreplaced placeholders as-is when var not provided', () => {
    const result = loadPrompt('unreplaced.txt', { NAME: 'Bob' });
    expect(result).toBe('Hello, Bob! Missing: {{MISSING}}');
  });

  it('throws Error when file does not exist', () => {
    expect(() => loadPrompt('nonexistent.txt')).toThrow('Prompt template not found');
  });

  it('caches file reads (same content on second call)', () => {
    const spy = jest.spyOn(fs, 'readFileSync');
    loadPrompt('simple.txt');
    loadPrompt('simple.txt');
    // readFileSync should only be called once due to cache
    const callsForSimple = spy.mock.calls.filter(
      (call) => String(call[0]).endsWith('simple.txt')
    );
    expect(callsForSimple.length).toBe(1);
    spy.mockRestore();
  });

  it('clearPromptCache allows re-reading files', () => {
    loadPrompt('cached.txt');
    clearPromptCache();
    fs.writeFileSync(path.join(tmpDir, 'cached.txt'), 'updated content');
    const result = loadPrompt('cached.txt');
    expect(result).toBe('updated content');
  });
});
