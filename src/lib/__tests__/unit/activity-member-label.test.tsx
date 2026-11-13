/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import MemberLabel from '@/app/activity/member-label';

const row = { login: 'ann', name: 'Ann Lee', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', total: 3, days: {} };

it('renders the stored avatar URL (CSP-allowed host), the display name and the total', () => {
  const { container } = render(<MemberLabel row={row} totalLabel="3 commits" />);
  expect(container.querySelector('img')!.getAttribute('src')).toBe(row.avatarUrl);
  expect(screen.getByText('Ann Lee').getAttribute('title')).toBe('ann');
  expect(screen.getByText('3 commits')).toBeTruthy();
});

it('never points an avatar at github.com, whose redirect the CSP blocks', () => {
  const { container } = render(<MemberLabel row={{ ...row, avatarUrl: '' }} totalLabel="0 commits" />);
  expect(container.querySelector('img')).toBeNull();
  expect(screen.getByTestId('avatar-fallback').textContent).toBe('A');
});

it('falls back to the login when the member has no report yet', () => {
  render(<MemberLabel row={{ ...row, name: '', avatarUrl: '' }} totalLabel="0 commits" />);
  expect(screen.getByText('ann')).toBeTruthy();
  expect(screen.getByTestId('avatar-fallback').textContent).toBe('A');
});
