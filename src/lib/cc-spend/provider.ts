export interface PerEmailAggregate {
  email: string;
  costCents: number;
  requests: number;
}

export interface CcSpendProbeResult {
  userCount: number;
  sampleEmail?: string;
}

export interface CcSpendProvider {
  /** Pull per-user CC spend aggregated across the [start, end] window (inclusive, YYYY-MM-DD). */
  pullByPeriod(periodStart: string, periodEnd: string, log?: (msg: string) => void): Promise<PerEmailAggregate[]>;
  /** Cheap connectivity / auth probe for a single day. */
  probe(date: string): Promise<CcSpendProbeResult>;
}

let cachedProvider: CcSpendProvider | null = null;

export function getCcSpendProvider(): CcSpendProvider {
  if (cachedProvider) return cachedProvider;

  if (process.env.CC_ANALYTICS_PROVIDER === 'mock') {
    const { createMockCcSpendProvider } = require('./mock-provider');
    cachedProvider = createMockCcSpendProvider();
    return cachedProvider!;
  }

  const { createAnthropicCcSpendProvider } = require('./anthropic-provider');
  cachedProvider = createAnthropicCcSpendProvider();
  return cachedProvider!;
}

// Test-only: reset the singleton so tests can swap providers.
export function __resetCcSpendProviderForTest(): void {
  cachedProvider = null;
}
