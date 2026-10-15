/**
 * Jira key detection utilities.
 *
 * Jira keys can appear in commit messages in multiple formats:
 *   - Standard:  TQCT-1576
 *   - With space: Tqct 1576, TQCT 1576
 *   - Mixed case: tqct-1576, Tqct-1576
 *
 * This module provides a single source of truth for detecting and
 * normalizing Jira keys across the codebase.
 */

/** Matches Jira keys with dash or space separator, case-insensitive. */
const JIRA_KEY_REGEX = /\b([A-Za-z]{2,10})[-\s](\d{1,6})\b/g;

/**
 * Extract all Jira keys from a text string.
 * Returns normalized keys in uppercase with dash (e.g., "TQCT-1576").
 */
export function extractJiraKeys(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let match;
  // Reset regex state
  JIRA_KEY_REGEX.lastIndex = 0;
  while ((match = JIRA_KEY_REGEX.exec(text)) !== null) {
    const project = match[1].toUpperCase();
    const number = match[2];
    // Filter out common false positives (git SHAs, version numbers, etc.)
    if (project.length < 2 || /^(SHA|GIT|NPM|CSS|HTML|HTTP|JSON|YAML|NODE|PULL|FEAT|FIX|DOCS|TEST|CHORE)$/.test(project)) continue;
    const key = `${project}-${number}`;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Find the first Jira key in a text string.
 * Returns { key, start, end } or null.
 */
export function findFirstJiraKey(text: string): { key: string; start: number; end: number } | null {
  JIRA_KEY_REGEX.lastIndex = 0;
  const match = JIRA_KEY_REGEX.exec(text);
  if (!match) return null;
  const project = match[1].toUpperCase();
  if (project.length < 2 || /^(SHA|GIT|NPM|CSS|HTML|HTTP|JSON|YAML|NODE|PULL|FEAT|FIX|DOCS|TEST|CHORE)$/.test(project)) return null;
  return {
    key: `${project}-${match[2]}`,
    start: match.index,
    end: match.index + match[0].length,
  };
}

// ---------------------------------------------------------------------------
// Validation for keys that reach Jira
// ---------------------------------------------------------------------------

/**
 * A full Jira issue key, anchored. Deliberately stricter than the detection
 * regex above: that one scans free text and tolerates spaces and mixed case,
 * whereas this gates values that are interpolated into JQL and into Jira REST
 * URL paths.
 */
export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d{1,10}$/;

export class InvalidJiraKeyError extends Error {
  constructor() {
    // Never echoes the rejected value: the callers that surface this are
    // reachable without credentials.
    super('Invalid Jira issue key');
    this.name = 'InvalidJiraKeyError';
  }
}

/**
 * Normalize and validate an issue key, or throw.
 *
 * Required because `searchChildIssues` built
 *   `"Epic Link" = ${epicKey} OR parent = ${epicKey} ORDER BY ...`
 * with no quoting, and `getTransitions` / `transitionIssue` / `updateDueDate`
 * interpolated the same value into `/issue/${issueKey}/...` with no encoding.
 * Both were reachable from unauthenticated routes, so the key controlled JQL
 * structure and could climb out of the REST base path.
 *
 * jira-projects/jql.ts already applies exactly this discipline to project keys
 * and status names; this extends it to issue keys.
 */
export function assertIssueKey(key: unknown): string {
  if (typeof key !== 'string') throw new InvalidJiraKeyError();
  const k = key.trim().toUpperCase();
  if (!ISSUE_KEY_RE.test(k)) throw new InvalidJiraKeyError();
  return k;
}

/** Non-throwing form for callers that want to branch rather than catch. */
export function isValidIssueKey(key: unknown): boolean {
  try { assertIssueKey(key); return true; } catch { return false; }
}

/**
 * Extract the project key from a validated issue key.
 * E.g., "GLOOK-123" → "GLOOK", "SPS_2-456" → "SPS_2"
 * Assumes the key has already been validated with assertIssueKey or isValidIssueKey.
 */
export function extractProjectKey(issueKey: string): string {
  return issueKey.split('-')[0];
}
