/** @jest-environment jsdom */
// src/lib/__tests__/unit/chart-accent-picker.test.tsx
// GLOOK-58 Decision 16: the Settings -> Appearance "Chart colors" control. Three native radios
// (Vivid/Soft/Deep) sharing one name, wired through useTheme()'s chartAccent/setChartAccent.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/app/theme-context';
import { ChartAccentPicker } from '@/app/settings/chart-accent-picker';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-chart-accent');
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderPicker() {
  return render(
    <ThemeProvider>
      <ChartAccentPicker />
    </ThemeProvider>,
  );
}

it('renders three radios labelled Vivid, Soft and Deep sharing one name', () => {
  renderPicker();
  const radios = screen.getAllByRole('radio') as HTMLInputElement[];
  expect(radios).toHaveLength(3);
  radios.forEach(r => expect(r.getAttribute('type')).toBe('radio'));
  const names = new Set(radios.map(r => r.getAttribute('name')));
  expect(names.size).toBe(1);
  expect(screen.getByRole('radio', { name: /vivid/i })).toBeDefined();
  expect(screen.getByRole('radio', { name: /soft/i })).toBeDefined();
  expect(screen.getByRole('radio', { name: /deep/i })).toBeDefined();
});

it('Vivid is checked by default', () => {
  renderPicker();
  expect((screen.getByRole('radio', { name: /vivid/i }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('radio', { name: /soft/i }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('radio', { name: /deep/i }) as HTMLInputElement).checked).toBe(false);
});

it('clicking Deep checks it, persists it, and applies the attribute', () => {
  renderPicker();
  fireEvent.click(screen.getByRole('radio', { name: /deep/i }));
  expect((screen.getByRole('radio', { name: /deep/i }) as HTMLInputElement).checked).toBe(true);
  expect(localStorage.getItem('glooker-chart-accent')).toBe('deep');
  expect(document.documentElement.getAttribute('data-chart-accent')).toBe('deep');
});

it('a pre-saved deep preference is restored and applied on a fresh mount', () => {
  localStorage.setItem('glooker-chart-accent', 'deep');
  renderPicker();
  expect((screen.getByRole('radio', { name: /deep/i }) as HTMLInputElement).checked).toBe(true);
  expect(document.documentElement.getAttribute('data-chart-accent')).toBe('deep');
});
