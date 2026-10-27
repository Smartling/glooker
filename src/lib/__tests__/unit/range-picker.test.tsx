/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RangePicker from '@/components/range/RangePicker';
import CurrentReportLabel from '@/components/range/CurrentReportLabel';
import { RANGE_OPTIONS, RANGE_LABELS } from '@/lib/report/range-options';
import { CHART_RANGES } from '@/components/range/chart-range';

it('renders one pressed button per option and reports clicks', () => {
  const onChange = jest.fn();
  render(<RangePicker options={RANGE_OPTIONS} labels={RANGE_LABELS} value="90d" onChange={onChange} ariaLabel="Date range" />);
  expect(screen.getByRole('group', { name: 'Date range' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Past 90 days' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Current report' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Past 12 months' }));
  expect(onChange).toHaveBeenCalledWith('12m');
});

it('the org chart options are unchanged after the move', () => {
  expect(CHART_RANGES).toEqual(['90d', '12m', 'all']);
});

it('labels per-report sections', () => {
  render(<CurrentReportLabel />);
  expect(screen.getByText('Current report')).toBeTruthy();
});
