/** @jest-environment jsdom */
// src/lib/__tests__/unit/filter-chip.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChip from '@/components/filter-chip';

it('shows the label, truncates with a title, and removes on ×', () => {
  const onRemove = jest.fn();
  render(<FilterChip label="Team: Platform" onRemove={onRemove} maxWidth={240} />);
  const chip = screen.getByTestId('filter-chip');
  expect(chip.textContent).toContain('Team: Platform');
  expect(chip.style.maxWidth).toBe('240px');
  expect(screen.getByText('Team: Platform').getAttribute('title')).toBe('Team: Platform');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Team: Platform filter' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});
