import { getLLMClient, LLM_MODEL, extraBodyProps } from './llm-provider';
import type { CommitData } from './github';

export interface CommitAnalysis {
  sha:           string;
  complexity:    number;   // 1–10
  type:          'feature' | 'bug' | 'refactor' | 'infra' | 'docs' | 'test' | 'other';
  impactSummary: string;
  riskLevel:     'low' | 'medium' | 'high';
  maybeAi:       boolean;  // LLM thinks this was AI-generated (when no co-author detected)
}

const COMPLEXITY_CALIBRATION = `
Complexity calibration (be strict):
  1-2: Trivial — typo fix, version bump, config change, adding a field to an existing model
  3-4: Simple — threading a new flag/parameter through existing layers, adding a column, wiring existing components
  5-6: Moderate — new API endpoint, new service class with real logic, non-trivial bug fix with behavioral change
  7-8: Significant — new subsystem or module (new service + controller + model + tests + wiring), cross-cutting refactor touching 10+ files with design decisions
  9-10: Major — new architecture pattern, new infrastructure component, system-wide redesign

Key differentiators to evaluate:
- Does the commit introduce NEW design decisions or just propagate an existing pattern?
- How many independent components/layers does it touch with DIFFERENT logic (not just adding the same field everywhere)?
- Are there new algorithms, data flows, or integration points? Or is it mechanical plumbing?
- Docs/plans/specs don't count toward code complexity.

A commit adding 1000+ lines of docs/plans but only 30 lines of code changes is 3-4, not 7-8.
A commit creating a brand new service with its own business logic, API, tests, and integrations is 7-8.`;

const SYSTEM_PROMPT = `You are a senior software engineer performing commit impact analysis.
Analyze the given commit and return a JSON object with exactly these fields:
- complexity: integer 1-10
- type: one of "feature", "bug", "refactor", "infra", "docs", "test", "other"
- impact_summary: one concise sentence describing what this commit achieves
- risk_level: one of "low", "medium", "high"
- maybe_ai: boolean — true if the code diff shows signs of being AI-generated or AI-assisted (e.g., unusually thorough comments/docstrings, boilerplate-heavy patterns, mechanical consistency, verbose variable naming, generated test patterns). Only set true if you have reasonable confidence.
${COMPLEXITY_CALIBRATION}
Return ONLY the raw JSON object, no markdown fences.`;

// Simpler prompt when AI co-author is already confirmed (skip the maybe_ai question)
const SYSTEM_PROMPT_AI_CONFIRMED = `You are a senior software engineer performing commit impact analysis.
Analyze the given commit and return a JSON object with exactly these fields:
- complexity: integer 1-10
- type: one of "feature", "bug", "refactor", "infra", "docs", "test", "other"
- impact_summary: one concise sentence describing what this commit achieves
- risk_level: one of "low", "medium", "high"
${COMPLEXITY_CALIBRATION}
Return ONLY the raw JSON object, no markdown fences.`;

export async function analyzeCommit(commit: CommitData): Promise<CommitAnalysis> {
  const client = await getLLMClient();
  const aiAlreadyConfirmed = commit.aiCoAuthored;

  const userMessage = `Repository: ${commit.repo}
Author: ${commit.authorName} (@${commit.author})
Commit message: ${commit.message}

Diff:
${commit.diff || '(no diff available)'}`;

  const response = await client.chat.completions.create({
    model:       LLM_MODEL,
    temperature: 0,
    max_tokens:  256,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: aiAlreadyConfirmed ? SYSTEM_PROMPT_AI_CONFIRMED : SYSTEM_PROMPT },
      { role: 'user',   content: userMessage },
    ],
    ...extraBodyProps(),
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
