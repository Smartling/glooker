/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RunCard, { logLineClass } from '@/components/runs/RunCard';
import RunHealthBadge from '@/components/runs/RunHealthBadge';
import RunsToolbar from '@/components/runs/RunsToolbar';

const base = {
  status: 'succeeded' as const, label: 'succeeded', subject: <span>acme · 30 days</span>,
  trigger: 'Scheduled', startedAt: '2026-09-22T10:00:00Z', finishedAt: '2026-09-22T10:04:12Z',
  expandable: true, expanded: false, onToggle: jest.fn(),
};

describe('RunCard', () => {
  it('renders the shared header: chip, subject, trigger, duration, start time', () => {
    render(<RunCard {...base} />);
    expect(screen.getByText('succeeded')).toBeTruthy();
    expect(screen.getByText('acme · 30 days')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('4m 12s')).toBeTruthy();
    expect(screen.getByText('Sep 22, 6:00 AM')).toBeTruthy();
  });
  it('omits the trigger when it is null (legacy rows)', () => {
    const { container } = render(<RunCard {...base} trigger={null} />);
    expect(container.textContent).not.toContain('Manual');
    expect(container.textContent).not.toContain('null');
  });
  it('toggles only when expandable, and shows children only when expanded', () => {
    const onToggle = jest.fn();
    const { rerender } = render(<RunCard {...base} onToggle={onToggle}><p>stats body</p></RunCard>);
    expect(screen.queryByText('stats body')).toBeNull();
    fireEvent.click(screen.getByText('acme · 30 days'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<RunCard {...base} onToggle={onToggle} expanded><p>stats body</p></RunCard>);
    expect(screen.getByText('stats body')).toBeTruthy();
    rerender(<RunCard {...base} onToggle={onToggle} expandable={false}><p>stats body</p></RunCard>);
    fireEvent.click(screen.getByText('acme · 30 days'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it('action clicks do not toggle the card', () => {
    const onToggle = jest.fn();
    render(<RunCard {...base} onToggle={onToggle} actions={<button>Delete</button>} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onToggle).not.toHaveBeenCalled();
  });
  it('renders a progress block with step, counter, error and collapsible logs', () => {
    render(<RunCard {...base} status="running" label="running" finishedAt={null}
      progress={{ step: 'Fetching', counter: '3 / 10 repos', pct: 30, running: true, tone: 'normal', error: 'boom', logs: ['a', 'b'] }} />);
    expect(screen.getByText('Fetching')).toBeTruthy();
    expect(screen.getByText('3 / 10 repos')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('a')).toBeTruthy();
    fireEvent.click(screen.getByText('Logs (2)'));
    expect(screen.queryByText('a')).toBeNull();
  });
});

describe('logLineClass', () => {
  it('colours errors, skips, LLM and dev lines consistently', () => {
    expect(logLineClass('ERROR x')).toContain('red');
    expect(logLineClass('[10:00] sync failed: boom')).toContain('red');
    expect(logLineClass('SKIP @a')).toContain('yellow');
    expect(logLineClass('LLM [x]')).toContain('accent');
    expect(logLineClass('DEV @a done')).toContain('green');
    expect(logLineClass('plain')).toContain('gray');
  });
});

describe('RunHealthBadge', () => {
  it('renders nothing for null and a titled pill otherwise', () => {
    const { container, rerender } = render(<RunHealthBadge health={null} />);
    expect(container.textContent).toBe('');
    rerender(<RunHealthBadge health={{ tone: 'error', label: 'incomplete', title: 'why' }} />);
    expect(screen.getByText('incomplete').getAttribute('title')).toBe('why');
  });
});

describe('RunsToolbar', () => {
  it('renders info, action and an inline error banner', () => {
    render(<RunsToolbar info="Daily at 0 6 * * *" action={<button>Sync alerts</button>} error="HTTP 409" />);
    expect(screen.getByText('Daily at 0 6 * * *')).toBeTruthy();
    expect(screen.getByText('Sync alerts')).toBeTruthy();
    expect(screen.getByText('HTTP 409')).toBeTruthy();
  });
});

describe('RunCard keyboard access', () => {
  it('the expandable header is a focusable button that toggles on Enter and Space', () => {
    const onToggle = jest.fn();
    render(<RunCard {...base} onToggle={onToggle} actions={<button>Delete</button>} />);
    const header = screen.getByRole('button', { name: /acme · 30 days/ });
    expect(header.getAttribute('tabindex')).toBe('0');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(header, { key: 'Enter' });
    fireEvent.keyDown(header, { key: ' ' });
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByText('Delete'), { key: 'Enter' }); // keys on an action are the action's own
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
  it('a non-expandable header is not a button', () => {
    render(<RunCard {...base} expandable={false} />);
    expect(screen.queryByRole('button', { name: /acme · 30 days/ })).toBeNull();
  });
});
