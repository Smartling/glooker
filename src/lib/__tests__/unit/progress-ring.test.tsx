/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { ProgressRing, type EpicRingStats } from '@/app/projects/progress-ring';

const stats = (over: Partial<EpicRingStats> = {}): EpicRingStats => ({
  epicKey: 'RND-1181',
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

const MAX_VOLUME = Math.log(31); // RND-1085: 30 child issues

describe('ProgressRing commits mode (unchanged default)', () => {
  it('draws four circles: two tracks and two arcs', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(4);
  });

  it('shows the developer count in the centre', () => {
    // Scoped to the centre span rather than getByText('3'): with devCount 3
    // the tooltip's "N devs" text also renders the literal "3", so an
    // unscoped text query is ambiguous between the two.
    const { container } = render(
      <ProgressRing stats={stats({ devCount: 3 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    const centre = container.querySelector('span.font-bold');
    expect(centre?.textContent).toBe('3');
  });

  it('renders an emerald inner arc', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    expect(container.querySelector('circle[stroke="#10B981"]')).not.toBeNull();
  });
});

describe('ProgressRing sizing (identical in both modes)', () => {
  it('renders the largest epic at 48px with a 3px stroke', () => {
    const { container } = render(
      <ProgressRing stats={stats({ totalJiras: 30, resolvedJiras: 30 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={0} />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('48');
    expect(container.querySelector('circle')!.getAttribute('stroke-width')).toBe('3');
  });

  it('floors a childless epic at 22px with an 8px stroke', () => {
    const { container } = render(
      <ProgressRing stats={stats({ totalJiras: 0, resolvedJiras: 0 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={0} />,
    );
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('22');
    expect(container.querySelector('circle')!.getAttribute('stroke-width')).toBe('8');
  });

  it('does not divide by zero when maxVolume is 0', () => {
    const { container } = render(
      <ProgressRing stats={stats({ totalJiras: 0 })} maxVolume={0} avgCommitsPerJira={0} />,
    );
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('22');
  });
});

describe('ProgressRing has no mode', () => {
  it('always draws four circles — two tracks and two arcs', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(4);
    expect(container.querySelector('circle[stroke="#10B981"]')).not.toBeNull();
  });
});
