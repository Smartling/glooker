import { buildPreamble } from '@/lib/chat/context/preamble';
import type { PageContext } from '@/lib/chat/context/types';

const base: PageContext = {
  kind: 'developer-report',
  label: 'Developer · @junky',
  params: { reportId: 'abc123', login: 'junky' },
  source: 'route',
};

describe('buildPreamble', () => {
  it('returns an empty string when there is no context', () => {
    expect(buildPreamble(null)).toBe('');
    expect(buildPreamble(undefined)).toBe('');
  });

  it('names the view and its params', () => {
    const out = buildPreamble(base);
    expect(out).toContain('Developer · @junky');
    expect(out).toContain('reportId=abc123');
    expect(out).toContain('login=junky');
  });

  it('instructs the model to resolve references against the view', () => {
    expect(buildPreamble(base).toLowerCase()).toContain('resolve');
  });

  it('includes filters when present', () => {
    expect(buildPreamble({ ...base, filters: { team: 'Integrations' } }))
      .toContain('team=Integrations');
  });

  it('includes key figures only when the page declared them', () => {
    const enriched: PageContext = {
      ...base,
      source: 'enriched',
      keyFigures: [{ label: 'Claude Code spend', value: '$48.30' }],
    };
    expect(buildPreamble(enriched)).toContain('$48.30');
  });

  // THE HARD RULE. Key figures are only trustworthy when a page declared them;
  // a route- or model-derived context must never smuggle values into the prompt.
  it('drops key figures when source is not enriched', () => {
    const smuggled: PageContext = {
      ...base,
      source: 'route',
      keyFigures: [{ label: 'Claude Code spend', value: '$48.30' }],
    };
    const out = buildPreamble(smuggled);
    expect(out).not.toContain('$48.30');
    expect(out).not.toContain('Claude Code spend');
  });

  it('marks inferred context as unverified', () => {
    const out = buildPreamble({ ...base, source: 'inferred' });
    expect(out.toLowerCase()).toContain('inferred');
  });

  it('stays within the 300-token budget (~1200 chars) for a realistic context', () => {
    const big: PageContext = {
      ...base,
      source: 'enriched',
      filters: { team: 'Integrations' },
      keyFigures: Array.from({ length: 8 }, (_, i) => ({ label: `Metric ${i}`, value: i * 100 })),
    };
    expect(buildPreamble(big).length).toBeLessThan(1200);
  });
});
