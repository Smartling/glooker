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
