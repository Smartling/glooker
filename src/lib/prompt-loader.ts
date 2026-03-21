import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = process.env.PROMPTS_DIR
  ? path.resolve(process.env.PROMPTS_DIR)
  : path.resolve(process.cwd(), 'prompts');

const cache = new Map<string, string>();

export function loadPrompt(filename: string, vars?: Record<string, string>): string {
  let text = cache.get(filename);
  if (!text) {
    const filePath = path.join(PROMPTS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt template not found: ${filePath}. Check PROMPTS_DIR (currently: ${PROMPTS_DIR})`);
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
