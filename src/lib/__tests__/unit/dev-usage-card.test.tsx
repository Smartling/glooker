/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { ClaudeCodeUsageCard } from '@/app/report/[id]/dev/[login]/usage-card';

it('renders spend, requests, skills invoked and both lists', () => {
  render(<ClaudeCodeUsageCard
    costCents={12345} requests={42} skillsUsed={12}
    skills={[{ product: 'cowork', skills_used: 12, skills_distinct: 4 }]}
    models={[{ model: 'claude-sonnet-5', cost: 500, requests: 20 }]}
  />);
  expect(screen.getByText('$123.45')).toBeTruthy();
  expect(screen.getByText('42')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy();
  expect(screen.getByText('cowork')).toBeTruthy();
  expect(screen.getByText(/12 used/)).toBeTruthy();
  expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
  expect(screen.getByText(/\$5\.00/)).toBeTruthy();
});

it('renders a model with cost and requests stripped without printing $undefined or NaN', () => {
  render(<ClaudeCodeUsageCard
    skills={[]} models={[{ model: 'claude-sonnet-5' }]}
  />);
  expect(screen.getByText('claude-sonnet-5')).toBeTruthy();
  expect(screen.queryByText(/undefined|NaN|\$/)).toBeNull();
});

it('shows an em dash for an absent spend and requests', () => {
  render(<ClaudeCodeUsageCard
    skillsUsed={0} skills={[]} models={[{ model: 'm1' }]}
  />);
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
});

it('renders nothing when no dimension has data', () => {
  const { container } = render(<ClaudeCodeUsageCard skills={[]} models={[]} />);
  expect(container.firstChild).toBeNull();
});

it('renders when only skills have data (zero spend)', () => {
  render(<ClaudeCodeUsageCard
    costCents={0} skills={[{ product: 'chat', skills_used: 0, skills_distinct: 3 }]} models={[]}
  />);
  expect(screen.getByText('chat')).toBeTruthy();
  expect(screen.getByText(/3 distinct/)).toBeTruthy();
});
