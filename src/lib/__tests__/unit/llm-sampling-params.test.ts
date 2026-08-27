/**
 * GLOOK-45. Claude Sonnet 5 (and the Opus 5 / Opus 4.7-4.8 / Fable 5 generation)
 * removed the sampling parameters: sending `temperature` — even `temperature: 0`
 * — returns a 400. Verified against the Smartling AI Proxy:
 *
 *   anthropic/claude-sonnet-4-20250514 + temperature 0.3  -> 200
 *   anthropic/claude-sonnet-5          + temperature 0.3  -> 400
 *   anthropic/claude-sonnet-5          + temperature 0    -> 400
 *   anthropic/claude-sonnet-5          (no temperature)   -> 200
 *
 * Every LLM call site in this repo passes a temperature, so the model swap needs
 * a central place to drop it. `samplingParams()` mirrors the existing
 * `tokenLimit()` helper: spread into chat.completions.create() at the call site.
 */
import { modelRejectsSampling } from '@/lib/llm-provider';

describe('modelRejectsSampling', () => {
  it.each([
    'claude-sonnet-5',
    'anthropic/claude-sonnet-5',            // Smartling AI Proxy prefix
    'us.anthropic.claude-sonnet-5',         // Bedrock cross-region inference profile
    'claude-opus-5',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-fable-5',
    'claude-mythos-5',
  ])('rejects sampling for %s', (model) => {
    expect(modelRejectsSampling(model)).toBe(true);
  });

  it.each([
    'claude-sonnet-4-20250514',             // what this repo ran before GLOOK-45
    'anthropic/claude-sonnet-4-20250514',
    'claude-sonnet-4-6',                    // 4.6 still accepts sampling
    'us.anthropic.claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5',
    'gpt-4o',                               // non-Anthropic providers unaffected
    '',
  ])('allows sampling for %s', (model) => {
    expect(modelRejectsSampling(model)).toBe(false);
  });

  it('is not fooled by a version substring inside a longer name', () => {
    // Guards against a loose regex matching "4-6" inside "4-60" or similar.
    expect(modelRejectsSampling('claude-opus-4-60')).toBe(false);
  });
});

describe('samplingParams', () => {
  const prev = process.env.LLM_MODEL;
  const prevProvider = process.env.LLM_PROVIDER;

  afterEach(() => {
    if (prev === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = prev;
    if (prevProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = prevProvider;
    jest.resetModules();
  });

  async function load(model: string) {
    jest.resetModules();
    process.env.LLM_PROVIDER = 'smartling';
    process.env.LLM_MODEL = model;
    return import('@/lib/llm-provider');
  }

  it('omits temperature entirely on Sonnet 5', async () => {
    const { samplingParams } = await load('anthropic/claude-sonnet-5');
    expect(samplingParams(0)).toEqual({});
    expect(samplingParams(0.3)).toEqual({});
  });

  it('passes temperature through on a model that accepts it', async () => {
    const { samplingParams } = await load('anthropic/claude-sonnet-4-20250514');
    expect(samplingParams(0)).toEqual({ temperature: 0 });
    expect(samplingParams(0.3)).toEqual({ temperature: 0.3 });
  });
});
