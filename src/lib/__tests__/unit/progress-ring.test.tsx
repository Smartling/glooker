/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import { ProgressRing, ringGeometry, type EpicRingStats } from '@/app/projects/progress-ring';

const stats = (over: Partial<EpicRingStats> = {}): EpicRingStats => ({
  epicKey: 'EPIC-1',
  totalJiras: 6,
  resolvedJiras: 0,
  remainingJiras: 6,
  commitCount: 0,
  devCount: 0,
  linesAdded: 0,
  linesRemoved: 0,
  repos: [],
  cached: false,
  ...over,
});

const MAX_VOLUME = Math.log(31); // an epic with 30 child issues is the page's largest

// Sector paths are "M x,y A r,r,0,largeArc,sweep,x,y ...". The first arc is the outer edge.
const arc = (p: Element) => {
  const m = /A\s*([\d.]+),([\d.]+),0,\s*([01]),/.exec(p.getAttribute('d') ?? '');
  return m ? { r: Number(m[1]), largeArc: m[3] === '1' } : null;
};
const sector = (c: HTMLElement, token: string) =>
  Array.from(c.querySelectorAll('.recharts-radial-bar-sectors path')).find(p => p.getAttribute('fill') === `var(${token})`);

describe('ringGeometry (size and stroke guarantees)', () => {
  it('sizes the largest epic at 48px with a 3px stroke', () => {
    expect(ringGeometry(stats({ totalJiras: 30, resolvedJiras: 30 }), MAX_VOLUME, 0)).toMatchObject({ px: 48, stroke: 3 });
  });
  it('floors a childless epic at 22px with an 8px stroke', () => {
    expect(ringGeometry(stats({ totalJiras: 0 }), MAX_VOLUME, 0)).toMatchObject({ px: 22, stroke: 8 });
  });
  it('does not divide by zero when maxVolume is 0', () => {
    const g = ringGeometry(stats({ totalJiras: 0 }), 0, 0);
    expect(g).toEqual({ px: 22, stroke: 8, jiraPct: 0, commitPct: 0 });
  });
  it('tolerates string counts from the API', () => {
    const g = ringGeometry(stats({ totalJiras: '10' as unknown as number, resolvedJiras: '4' as unknown as number }), MAX_VOLUME, 1);
    expect(g.jiraPct).toBeCloseTo(0.4);
  });
  it('clamps jiraPct to 1 when resolvedJiras exceeds totalJiras (bad data)', () => {
    // Unreachable via real data today (resolvedJiras is a subset of totalJiras), but an
    // unclamped value over 1 would widen the shared 0-100 PolarAngleAxis domain and silently
    // shrink every other ring sharing it. Asserted directly on the geometry, not just through
    // the render: RadialBar's default allowDataOverflow clips an out-of-domain value visually,
    // so a render-only assertion wouldn't catch a missing clamp here.
    const g = ringGeometry(stats({ totalJiras: 4, resolvedJiras: 6 }), MAX_VOLUME, 1);
    expect(g.jiraPct).toBe(1);
  });
});

describe('ProgressRing render', () => {
  it('renders an SVG at the computed size', () => {
    const { container } = render(<ProgressRing stats={stats({ totalJiras: 30, resolvedJiras: 30 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={0} />);
    expect(container.querySelector('svg.recharts-surface')!.getAttribute('width')).toBe('48');
    const zero = render(<ProgressRing stats={stats({ totalJiras: 0 })} maxVolume={0} avgCommitsPerJira={0} />);
    expect(zero.container.querySelector('svg.recharts-surface')!.getAttribute('width')).toBe('22');
  });

  it('shows the developer count in the centre', () => {
    const { container } = render(<ProgressRing stats={stats({ devCount: 3 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    expect(container.querySelector('span.font-bold')?.textContent).toBe('3');
  });

  it('draws Jira on the outer ring and commits on the inner ring, each over a track', () => {
    const s = stats({ totalJiras: 10, resolvedJiras: 4, commitCount: 2 });
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    const jira = arc(sector(container, '--chart-ring-jira')!);
    const commits = arc(sector(container, '--chart-ring-commits')!);
    expect(jira!.r).toBeGreaterThan(commits!.r);
    const tracks = Array.from(container.querySelectorAll('.recharts-radial-bar-background-sector'));
    expect(tracks).toHaveLength(2);
    tracks.forEach(t => expect(t.getAttribute('fill')).toBe('var(--chart-track)'));
  });

  it('fixes the angle domain at 0-100, so 40% draws as a minor arc, not a full ring', () => {
    const s = stats({ totalJiras: 10, resolvedJiras: 4, commitCount: 2 }); // Jira 40%, commits 20%
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    expect(arc(sector(container, '--chart-ring-jira')!)!.largeArc).toBe(false);
  });

  it('draws 75% as a major arc', () => {
    const s = stats({ totalJiras: 4, resolvedJiras: 3, commitCount: 1 });
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    expect(arc(sector(container, '--chart-ring-jira')!)!.largeArc).toBe(true);
  });

  it('with every value at 0: both tracks draw, no arc draws, and no path contains NaN', () => {
    const zero = stats({ totalJiras: 0, resolvedJiras: 0, remainingJiras: 0 });
    const { container } = render(<ProgressRing stats={zero} maxVolume={0} avgCommitsPerJira={0} />);
    expect(container.querySelectorAll('.recharts-radial-bar-background-sector')).toHaveLength(2);
    expect(sector(container, '--chart-ring-jira')).toBeUndefined();
    expect(sector(container, '--chart-ring-commits')).toBeUndefined();
    Array.from(container.querySelectorAll('path')).forEach(p => expect(p.getAttribute('d') ?? '').not.toContain('NaN'));
    expect(container.querySelector('span.font-bold')?.textContent).toBe('0');
  });

  it('clamps a jiraPct over 1 (bad data) so the Jira ring draws full and the commits ring keeps its own half arc', () => {
    // resolvedJiras > totalJiras is unreachable via real data today, but ringGeometry must not
    // hand RadialBar a value over 100 — that would widen the shared 0-100 domain and shrink
    // every other ring sharing it, including the correctly-computed commits ring below.
    const s = stats({ totalJiras: 4, resolvedJiras: 6, commitCount: 2 }); // Jira 150% raw, commits 50%
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    const jira = arc(sector(container, '--chart-ring-jira')!);
    const commits = arc(sector(container, '--chart-ring-commits')!);
    expect(jira).not.toBeNull();
    expect(commits).not.toBeNull();
    expect(jira!.largeArc).toBe(true); // clamped to 100%, draws (nearly) full
    expect(commits!.largeArc).toBe(false); // its own 50% is unaffected, still a half arc
    expect(jira!.r).toBeGreaterThan(commits!.r); // Jira still outer, commits still inner
    Array.from(container.querySelectorAll('path')).forEach(p => expect(p.getAttribute('d') ?? '').not.toContain('NaN'));
  });
});

describe('ProgressRing accessibility', () => {
  it('leaves the ring out of the tab order and exposes an accessible name on the wrapper', () => {
    const s = stats({ totalJiras: 5, resolvedJiras: 3, commitCount: 2, devCount: 2 });
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    const svg = container.querySelector('svg.recharts-surface')!;
    expect(svg.getAttribute('tabindex')).not.toBe('0');
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute('aria-label')).toBe('Jira 3/5 closed, commits 40% of expected, 2 devs');
  });
});
