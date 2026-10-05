import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = process.env.PROMPTS_DIR
  ? path.resolve(process.env.PROMPTS_DIR)
  : path.resolve(process.cwd(), 'prompts');

const cache = new Map<string, string>();

/**
 * Containment check.
 *
 * Every current call site passes a hardcoded literal, so no request-controlled
 * value reaches `path.join` today — Aikido's path-traversal finding here is a
 * false positive on that basis. It is still worth the four lines: the signature
 * accepts any string, so the function is safe by call-site discipline alone, and
 * a future feature that lets a user pick a template (plausible in a product that
 * already surfaces `promptsDir` through its settings API) would turn it into a
 * real traversal with no change to this file.
 */
function resolveWithinPromptsDir(filename: string): string {
  const resolved = path.resolve(PROMPTS_DIR, filename);
  if (resolved !== PROMPTS_DIR && !resolved.startsWith(PROMPTS_DIR + path.sep)) {
    throw new Error('Prompt template path escapes PROMPTS_DIR');
  }
  return resolved;
}

export function loadPrompt(filename: string, vars?: Record<string, string>): string {
  let text = cache.get(filename);
  if (!text) {
    const filePath = resolveWithinPromptsDir(filename);
    if (!fs.existsSync(filePath)) {
      // Does not echo the resolved absolute path: two handlers used to return
      // err.message to unauthenticated callers, which would have disclosed the
      // container's filesystem layout on a PROMPTS_DIR misconfiguration.
      throw new Error(`Prompt template not found: ${filename}. Check PROMPTS_DIR.`);
    }
    text = fs.readFileSync(filePath, 'utf-8');
    cache.set(filename, text);
  }
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
  }
  return text;
}

export function clearPromptCache(): void {
  cache.clear();
}
