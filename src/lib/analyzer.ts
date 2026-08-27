import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag, samplingParams } from './llm-provider';
import { loadPrompt } from './prompt-loader';
import { getAppConfig } from './app-config/service';
import { stripInvisible, sanitizeAuthorName } from './sanitize';
import type { CommitData } from './github';

export interface CommitAnalysis {
  sha:           string;
  complexity:    number;   // 1–10
  type:          'feature' | 'bug' | 'refactor' | 'infra' | 'docs' | 'test' | 'other';
  impactSummary: string;
  riskLevel:     'low' | 'medium' | 'high';
  maybeAi:       boolean;  // LLM thinks this was AI-generated (when no co-author detected)
}


export async function analyzeCommit(commit: CommitData): Promise<CommitAnalysis> {
  const client = await getLLMClient();
  const aiAlreadyConfirmed = commit.aiCoAuthored;

  const calibration = loadPrompt('analyzer-calibration.txt');
  const systemPrompt = commit.aiCoAuthored
    ? loadPrompt('analyzer-system-ai-confirmed.txt', { COMPLEXITY_CALIBRATION: calibration })
    : loadPrompt('analyzer-system.txt', { COMPLEXITY_CALIBRATION: calibration });

  const userMessage = buildAnalyzerUserMessage(commit);

  const response = await client.chat.completions.create({
    model:       LLM_MODEL,
    ...samplingParams(getAppConfig().analyzer.temperature),
    ...tokenLimit(getAppConfig().analyzer.maxTokens),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
    ...extraBodyProps(),
    ...promptTag(commit.aiCoAuthored ? 'analyzer-system-ai-confirmed' : 'analyzer-system'),
  } as any);

  const content = response.choices[0].message.content;
  const raw = (Array.isArray(content) ? content.join('') : String(content ?? '{}'));
  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }

  return {
    sha:           commit.sha,
    complexity:    clamp(Number(parsed.complexity) || 5, 1, 10),
    type:          validateType(String(parsed.type || 'other')),
    impactSummary: String(parsed.impact_summary || ''),
    riskLevel:     validateRisk(String(parsed.risk_level || 'low')),
    maybeAi:       aiAlreadyConfirmed ? false : Boolean(parsed.maybe_ai),
  };
}

export function buildAnalyzerUserMessage(commit: CommitData): string {
  const safeRepo    = stripInvisible(commit.repo);
  const safeAuthor  = sanitizeAuthorName(commit.authorName);
  const safeMessage = stripInvisible(commit.message);
  const safeDiff    = stripInvisible(commit.diff || '(no diff available)');
  // commit.author is a GitHub login — constrained to [a-zA-Z0-9-] by GitHub,
  // no sanitization needed.
  return `Repository: ${safeRepo}
Author: ${safeAuthor} (@${commit.author})
Commit message: ${safeMessage}

Diff:
<untrusted_data>
${safeDiff}
</untrusted_data>`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function validateType(t: string): CommitAnalysis['type'] {
  const valid = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other'] as const;
  return (valid as readonly string[]).includes(t) ? (t as CommitAnalysis['type']) : 'other';
}

function validateRisk(r: string): CommitAnalysis['riskLevel'] {
  const valid = ['low', 'medium', 'high'] as const;
  return (valid as readonly string[]).includes(r) ? (r as CommitAnalysis['riskLevel']) : 'low';
}
