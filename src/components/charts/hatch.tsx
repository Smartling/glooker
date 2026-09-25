'use client';

// GLOOK-58 Hatch: in-flight is never shown by colour alone. The pattern has an explicit
// --chart-surface background (never transparent) and ~2px diagonal stripes in the given colour.
// Each instance gets its own id from useId(): a page shows several charts in one document-wide
// id space, so a static id would make the accent and in-flight patterns collide.
import { useId, type ReactElement } from 'react';
import { cssIdent } from './chart';

const TILE = 6;

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
