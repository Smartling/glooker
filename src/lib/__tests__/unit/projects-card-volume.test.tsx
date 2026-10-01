/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import ProjectsCard from '@/components/ProjectsCard';

const project = { name: 'Alpha', summary: '', developers: [], jira_count: 2, estimated_commits: 3, estimated_prs: 1 };

it('draws the volume bar from chart tokens that exist in both theme modes', () => {
  const { container } = render(<ProjectsCard projects={[project]} />);
  const bar = container.querySelector('[role="img"][aria-label^="Volume:"]') as HTMLElement;
  expect(bar.style.backgroundColor).toBe('var(--chart-track)');
  // Not `bar.querySelectorAll(':scope > div > div')`: nwsapi (jsdom's selector engine, v2.2.23
  // here) mis-parses `:scope` when the scoping element's class contains Tailwind arbitrary-value
  // brackets (e.g. `h-[5px]`), throwing "not a valid selector". Direct child traversal sidesteps it.
  const segments = Array.from((bar.firstElementChild as HTMLElement).children) as HTMLElement[];
  expect(segments.map(s => s.style.backgroundColor)).toEqual([
    'var(--chart-volume-prs)', 'var(--chart-volume-jiras)', 'var(--chart-volume-commits)',
  ]);
});

it('legend swatches use the same tokens as the segments', () => {
  const { container } = render(<ProjectsCard projects={[project]} />);
  const swatches = Array.from(container.querySelectorAll('span[aria-hidden="true"].rounded-\\[2px\\]')) as HTMLElement[];
  expect(swatches.map(s => s.style.backgroundColor)).toEqual([
    'var(--chart-volume-prs)', 'var(--chart-volume-jiras)', 'var(--chart-volume-commits)',
  ]);
});
