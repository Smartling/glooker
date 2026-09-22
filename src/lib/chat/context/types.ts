/** A figure the page declares as essential. Tier 2 only. */
export interface KeyFigure {
  label: string;
  value: string | number;
}

/**
 * What the chat knows about the view the user is looking at.
 *
 * This is a DESCRIPTOR, not a data snapshot. It names the view so the agent can
 * fetch the real numbers through its tools under the caller's identity. It must
 * never carry a value the viewer's own cost-visibility rules would strip.
 */
export interface PageContext {
  /** Stable machine key for the view, e.g. 'developer-report'. */
  kind: string;
  /** Human-readable, rendered in the chip: "Developer · @junky". */
  label: string;
  /** Route params, renamed to domain names (id -> reportId). */
  params: Record<string, string>;
  /** Allowlisted URL search params. Omitted when empty. */
  filters?: Record<string, string>;
  /** Tier 2 only: figures the page declared. Omitted when empty. */
  keyFigures?: KeyFigure[];
  /** Which tier produced this. Drives chip wording and adoption reporting. */
  source: 'route' | 'enriched' | 'inferred';
}

export interface RegistryEntry {
  /** Next.js route pattern, e.g. '/report/[id]/dev/[login]'. */
  pattern: string;
  kind: string;
  /** Receives domain-renamed params. */
  label: (params: Record<string, string>) => string;
  /** Next param name -> domain name. Unlisted params are dropped. */
  paramMap?: Record<string, string>;
  /** Search params worth carrying. Everything else is dropped. */
  filterKeys?: string[];
  /** Suggested questions seeded into the chat for this view. */
  suggestions: string[];
}
