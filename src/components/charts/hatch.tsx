'use client';

// GLOOK-58 Hatch: in-flight is never shown by colour alone. The pattern has an explicit
// --chart-surface background (never transparent) and ~2px diagonal stripes in the given colour.
// Each instance gets its own id from useId(): a page shows several charts in one document-wide
// id space, so a static id would make the accent and in-flight patterns collide.
import { useId, type ReactElement } from 'react';
import { cssIdent } from './chart';
import { toNum } from './chart-format';

const TILE = 6;

/**
 * A Bar's `minPointSize` callback receives `value[1]`, the cumulative top of THIS Bar's slice in
 * a stack (e.g. shipped + inFlight), not the series' own delta — so on a shipped-only week that
 * cumulative top is still non-zero, and a naive `minPointSize={v => v !== 0 ? 4 : 0}` would floor
 * the hatch on every week regardless of whether it actually has in-flight work (GLOOK-58 final
 * review; confirmed by reading node_modules/recharts/es6/cartesian/Bar.js). This reads the row's
 * own value for `key` by index instead, floored to a legible 4px only when it isn't zero, so a
 * real in-flight segment always shows at least one visible stripe and a zero-in-flight week draws
 * no hatch rect at all. Shared by TimelineChart, StackedTypesChart and LinesChangedChart, each of
 * which called this identically three times before.
 */
export function inFlightFloor<T>(rows: T[], key: keyof T): (value: unknown, index: number) => number {
  return (_, i) => (toNum(rows[i]?.[key]) !== 0 ? 4 : 0);
}

export interface Hatch {
  id: string;
  fill: string;
  defs: ReactElement;
}

export function useHatch(colorVar: string): Hatch {
  const id = `hatch-${cssIdent(useId())}`;
  const defs = (
    <defs>
      <pattern id={id} width={TILE} height={TILE} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={TILE} height={TILE} style={{ fill: 'var(--chart-surface)' }} />
        <line x1={TILE / 2} y1={0} x2={TILE / 2} y2={TILE} style={{ stroke: colorVar, strokeWidth: 2 }} />
      </pattern>
    </defs>
  );
  return { id, fill: `url(#${id})`, defs };
}

/** A hatched legend swatch that carries its own pattern, so it works outside any chart's <svg>. */
export function HatchSwatch({ colorVar, size = 10 }: { colorVar: string; size?: number }) {
  const hatch = useHatch(colorVar);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 rounded-sm">
      {hatch.defs}
      <rect width={size} height={size} fill={hatch.fill} />
    </svg>
  );
}

/**
 * A small legend/swatch mark: hatched when `hatched` is true, otherwise a solid fill of
 * `colorVar`. Shared by StackedTypesChart, LinesChangedChart and CommitTypeDonut, each of which
 * decides `hatched` from its own "is this the in_flight type" check (GLOOK-58 review, fix
 * round 1 — this rendering was duplicated three times before).
 */
export function TypeSwatch({ colorVar, size = 10, hatched = false }: { colorVar: string; size?: number; hatched?: boolean }) {
  if (hatched) return <HatchSwatch colorVar={colorVar} size={size} />;
  return <i aria-hidden="true" className="rounded-sm shrink-0 inline-block" style={{ width: size, height: size, background: colorVar }} />;
}
