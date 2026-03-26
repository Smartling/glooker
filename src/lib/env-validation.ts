/**
 * Startup environment variable validation.
 *
 * Checks that required env vars are present and optional vars have sensible
 * values. Runs in warn mode — logs problems but never crashes the server,
 * because some vars are only needed for specific features.
 */

interface EnvRule {
  name: string;
  required: boolean;
  description: string;
  /** Optional validator — return an error string or null if OK. */
  validate?: (value: string) => string | null;
}

const VALID_LLM_PROVIDERS = ['openai', 'anthropic', 'openai-compatible', 'smartling', 'bedrock'];
const VALID_DB_TYPES = ['sqlite', 'mysql'];

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
    when: () => process.env.JIRA_ENABLED === 'true',
    featureLabel: 'JIRA_ENABLED=true',
    vars: [
      { name: 'JIRA_HOST', description: 'Jira Cloud hostname (e.g. mycompany.atlassian.net)' },
      { name: 'JIRA_USERNAME', description: 'Jira username / email' },
      { name: 'JIRA_API_TOKEN', description: 'Jira API token' },
    ],
  },
  {
    when: () => process.env.AUTH_ENABLED === 'true',
    featureLabel: 'AUTH_ENABLED=true',
    vars: [
      { name: 'AUTH_ADMIN_GROUP', description: 'Okta group for admin role (without this, no one can run reports or manage settings)' },
    ],
  },
];

export function validateEnv(): void {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check core rules
  for (const rule of rules) {
    const value = process.env[rule.name];

    if (!value || value.trim() === '') {
      if (rule.required) {
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
