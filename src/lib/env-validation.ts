/**
 * Startup environment variable validation.
 *
 * Checks that required env vars are present and optional vars have sensible
 * values. Runs in warn mode — logs problems but never crashes the server,
 * because some vars are only needed for specific features.
 */

import fs from 'fs';
import path from 'path';
import { getVulnConfig, KNOWN_VULN_ENV_VARS } from './vulnerabilities/config';

interface EnvRule {
  name: string;
  required: boolean;
  description: string;
  /** Optional validator — return an error string or null if OK. */
  validate?: (value: string) => string | null;
}

const VALID_LLM_PROVIDERS = ['openai', 'anthropic', 'openai-compatible', 'smartling', 'bedrock', 'mock'];
const VALID_DB_TYPES = ['sqlite', 'mysql'];
const VALID_JIRA_PROVIDERS = ['mock'];
const VALID_GITHUB_PROVIDERS = ['mock'];

function isMockProvider(service: 'llm' | 'jira' | 'github'): boolean {
  const envMap = { llm: 'LLM_PROVIDER', jira: 'JIRA_PROVIDER', github: 'GITHUB_PROVIDER' };
  return process.env[envMap[service]] === 'mock';
}

const rules: EnvRule[] = [
  // ---- Required ----
  {
    name: 'GITHUB_TOKEN',
    required: true,
    description: 'GitHub personal access token (fine-grained)',
  },

  // ---- Optional with validation ----
  {
    name: 'LLM_PROVIDER',
    required: false,
    description: `LLM backend (${VALID_LLM_PROVIDERS.join(', ')})`,
    validate: (v) =>
      VALID_LLM_PROVIDERS.includes(v)
        ? null
        : `must be one of: ${VALID_LLM_PROVIDERS.join(', ')}`,
  },
  {
    name: 'DB_TYPE',
    required: false,
    description: `Database type (${VALID_DB_TYPES.join(', ')})`,
    validate: (v) =>
      VALID_DB_TYPES.includes(v)
        ? null
        : `must be one of: ${VALID_DB_TYPES.join(', ')}`,
  },
  {
    name: 'LLM_CONCURRENCY',
    required: false,
    description: 'Max concurrent LLM requests (positive integer)',
    validate: (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n > 0
        ? null
        : 'must be a positive integer';
    },
  },
  {
    name: 'AUTH_ENABLED',
    required: false,
    description: 'Enable user profile via ALB OIDC (true/false)',
    validate: (v) =>
      ['true', 'false'].includes(v)
        ? null
        : 'must be true or false',
  },
  {
    name: 'JIRA_PROVIDER',
    required: false,
    description: `Jira provider (${VALID_JIRA_PROVIDERS.join(', ')})`,
    validate: (v) =>
      VALID_JIRA_PROVIDERS.includes(v) ? null : `must be one of: ${VALID_JIRA_PROVIDERS.join(', ')}`,
  },
  {
    name: 'GITHUB_PROVIDER',
    required: false,
    description: `GitHub provider (${VALID_GITHUB_PROVIDERS.join(', ')})`,
    validate: (v) =>
      VALID_GITHUB_PROVIDERS.includes(v) ? null : `must be one of: ${VALID_GITHUB_PROVIDERS.join(', ')}`,
  },

  // ---- Optional, legacy ----
  {
    name: 'JIRA_PROJECTS_JQL',
    required: false,
    description: 'Legacy JQL that seeds a first jira_projects row on upgrade and supplies the ' +
      'untracked-work project keys (e.g. project = SPS AND issuetype = Epic AND status = "In Progress" ' +
      '— note `status`, not `statusCategory`: the migration cannot map a category onto a status name). ' +
      'Superseded by Settings → Projects; safe to leave unset on a new deployment.',
  },
];

/**
 * Conditionally-required vars: only checked when a feature is enabled.
 */
const conditionalRules: {
  when: () => boolean;
  featureLabel: string;
  vars: { name: string; description: string }[];
}[] = [
  {
    when: () => {
      const p = process.env.LLM_PROVIDER || 'openai'; // default is openai
      return p === 'openai' || p === 'anthropic';
    },
    featureLabel: 'LLM_PROVIDER=openai/anthropic',
    vars: [
      { name: 'LLM_API_KEY', description: 'API key for the LLM provider' },
    ],
  },
  {
    when: () => process.env.DB_TYPE === 'mysql',
    featureLabel: 'DB_TYPE=mysql',
    vars: [
      { name: 'DB_HOST', description: 'MySQL host' },
      { name: 'DB_USER', description: 'MySQL user' },
      { name: 'DB_NAME', description: 'MySQL database name' },
    ],
  },
  {
    when: () => process.env.JIRA_ENABLED === 'true' && !isMockProvider('jira'),
    featureLabel: 'JIRA_ENABLED=true',
    vars: [
      { name: 'JIRA_HOST', description: 'Jira Cloud hostname (e.g. mycompany.atlassian.net)' },
      { name: 'JIRA_USERNAME', description: 'Jira username / email' },
      { name: 'JIRA_API_TOKEN', description: 'Jira API token' },
      // JIRA_PROJECTS_JQL is deliberately NOT required here: the Projects
      // board is configured from Settings → Projects (jira_projects table),
      // not this env var. See its entry in `rules` above — it's optional
      // and legacy. A deployment with no jira_projects rows and no
      // JIRA_PROJECTS_JQL simply shows "No Jira projects configured." rather
      // than warning at startup.
    ],
  },
  {
    when: () => process.env.AUTH_ENABLED === 'true',
    featureLabel: 'AUTH_ENABLED=true',
    vars: [
      { name: 'AUTH_ADMIN_GROUP', description: 'Okta group for admin role (without this, no one can run reports or manage settings)' },
    ],
  },
  {
    when: () => process.env.CC_ANALYTICS_PROVIDER !== 'mock',
    featureLabel: 'CC_ANALYTICS_PROVIDER!=mock',
    vars: [
      { name: 'ANTHROPIC_ANALYTICS_API_KEY', description: 'Anthropic Analytics API key (read:analytics scope) — without this, Claude usage cost will not be pulled during report runs (set CC_ANALYTICS_PROVIDER=mock for local dev)' },
    ],
  },
];

export function validateEnv(): void {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check core rules
  for (const rule of rules) {
    const value = process.env[rule.name];

    // Skip required check for GITHUB_TOKEN when using mock GitHub
    const isRequired = rule.name === 'GITHUB_TOKEN' ? !isMockProvider('github') : rule.required;

    if (!value || value.trim() === '') {
      if (isRequired) {
        errors.push(`  - ${rule.name}: missing (${rule.description})`);
      }
      continue;
    }

    if (rule.validate) {
      const err = rule.validate(value.trim());
      if (err) {
        warnings.push(`  - ${rule.name}: ${err} (got "${value}")`);
      }
    }
  }

  // Check conditional rules
  for (const group of conditionalRules) {
    if (!group.when()) continue;
    for (const v of group.vars) {
      const value = process.env[v.name];
      if (!value || value.trim() === '') {
        warnings.push(`  - ${v.name}: missing (needed when ${group.featureLabel}) — ${v.description}`);
      }
    }
  }

  // No org allowlist: `org` is caller-supplied on ~14 routes, including two that
  // proxy the server's GitHub PAT at whichever org is named.
  if (!process.env.ALLOWED_ORGS?.trim()) {
    warnings.push(
      '  - ALLOWED_ORGS: not set — any well-shaped org name is accepted, so the GitHub PAT '
      + 'can be aimed at any organisation and any org in the database can be read',
    );
  }

  // Auth is enabled but no way to verify a token's signature is configured.
  // extractUser() denies every request in that state rather than trusting the
  // header, so this is a hard error: the app is up but nobody can sign in.
  if (process.env.AUTH_ENABLED === 'true'
      && !process.env.AUTH_JWKS_URL?.trim()
      && !process.env.AUTH_ALB_REGION?.trim()) {
    errors.push(
      '  - AUTH_ALB_REGION or AUTH_JWKS_URL: missing (exactly one is required when AUTH_ENABLED=true — '
      + "without it identity tokens cannot be verified and every request is denied)",
    );
  }
  if (process.env.AUTH_JWKS_URL?.trim() && process.env.AUTH_ALB_REGION?.trim()) {
    warnings.push('  - AUTH_JWKS_URL and AUTH_ALB_REGION are both set; AUTH_JWKS_URL wins and AUTH_ALB_REGION is ignored');
  }

  // The MCP path (Okta access token forwarded by mcp-okta-proxy) needs both an
  // issuer and an audience; with only one, extractUser() denies Okta tokens.
  const oktaIss = process.env.AUTH_OKTA_ISSUER?.trim();
  const oktaAud = process.env.AUTH_OKTA_AUDIENCE?.trim();
  if (Boolean(oktaIss) !== Boolean(oktaAud)) {
    errors.push(
      '  - AUTH_OKTA_ISSUER / AUTH_OKTA_AUDIENCE: only one is set — both are required to verify '
      + 'Okta access tokens from the MCP sidecar, so MCP requests are being denied',
    );
  }

  // Authentication is off entirely. Previously silent — a dropped AUTH_ENABLED
  // turned every authorization check in the app into "allow" with no signal at
  // all, which is the failure mode this banner exists to make impossible to miss.
  const authOn = process.env.AUTH_ENABLED === 'true'
    || (process.env.AUTH_ENABLED !== 'false' && process.env.NODE_ENV === 'production');
  if (!authOn) {
    const anonAdmin = process.env.NODE_ENV !== 'production'
      || process.env.AUTH_ALLOW_ANONYMOUS_ADMIN === 'true';
    console.error(
      '\n[ALERT] Glooker: AUTHENTICATION IS DISABLED (AUTH_ENABLED is not "true").\n'
      + `   Admin-gated routes are ${anonAdmin ? 'OPEN to anonymous callers' : 'denied to everyone'}, and\n`
      + '   per-developer Claude spend is not redacted. Set AUTH_ENABLED=true in any\n'
      + '   environment where the app port is network-reachable.\n',
    );
  }

  // AUTH_TEST_USER fabricates one identity for every request and never reads the
  // real token. It is inert under NODE_ENV=production by construction now, but
  // still worth announcing wherever it IS active.
  if (process.env.AUTH_TEST_USER) {
    const email = process.env.AUTH_TEST_EMAIL || 'testuser@glooker.dev';
    const inert = process.env.NODE_ENV === 'production';
    console.error(
      `\n[ALERT] Glooker: AUTH_TEST_USER=${process.env.AUTH_TEST_USER} is set.\n`
      + (inert
        ? '   NODE_ENV=production, so this bypass is IGNORED and the real token is used.\n'
        : `   Every request is served as the fabricated identity "${email}" — the real\n`
          + '   identity header is never read. Local development only.\n'),
    );
  }

  // Special-case: LOG_DIR writability check (requires filesystem I/O)
  const logDir = process.env.LOG_DIR;
  if (logDir) {
    const resolved = path.resolve(logDir);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch (err) {
      warnings.push(`  - LOG_DIR: directory "${resolved}" is not writable — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // GLOOK-43 Wave P: getVulnConfig().errors covers two different things. An unrecognised
  // VULN_/VULNERABILITIES_ variable name is reported unconditionally — a misspelled
  // VULNERABILITIES_ORG itself must still warn, even though the feature reads as "off" once
  // that's the case. Every other configuration problem (SLA policy JSON, VULN_RESOLVED_SINCE,
  // property keys, tier, codebase groups) only matters once the feature is actually on, so it
  // stays inside the gate below alongside the cron/TZ checks. Messages never echo the configured
  // value — ConfigError has no value field, by construction (types.ts).
  const vulnErrors = getVulnConfig().errors;
  for (const e of vulnErrors) {
    if (!KNOWN_VULN_ENV_VARS.has(e.variable)) warnings.push(`  - ${e.rule}`);
  }

  // GLOOK-43: vulnerability sync schedule and deployment configuration — validated only when the
  // feature is on.
  if (process.env.VULNERABILITIES_ORG?.trim()) {
    for (const e of vulnErrors) {
      if (KNOWN_VULN_ENV_VARS.has(e.variable)) warnings.push(`  - ${e.rule}`);
    }
    const cron = process.env.VULN_SYNC_CRON?.trim();
    if (cron) {
      try { const { Cron } = require('croner'); new Cron(cron, { paused: true }).stop(); }
      catch { warnings.push('  - VULN_SYNC_CRON: not a valid cron expression'); }
    }
    const tz = process.env.VULN_SYNC_TZ?.trim();
    if (tz) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); }
      catch { warnings.push('  - VULN_SYNC_TZ: not a valid IANA time zone'); }
    }
  }

  // Report
  if (errors.length > 0) {
    console.error(
      `\n[ERROR] Glooker: required environment variables are missing:\n${errors.join('\n')}\n` +
      `   The server will start, but core features will not work.\n` +
      `   See .env.example for reference.\n`
    );
  }

  if (warnings.length > 0) {
    console.warn(
      `\n[WARN] Glooker: environment variable issues:\n${warnings.join('\n')}\n` +
      `   See .env.example for reference.\n`
    );
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('Glooker: environment validation passed.');
  }
}
