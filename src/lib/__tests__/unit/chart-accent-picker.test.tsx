/** @jest-environment jsdom */
// src/lib/__tests__/unit/chart-accent-picker.test.tsx
// GLOOK-58 Decision 16: the Settings -> Appearance "Chart colors" control. Three native radios
// (Vivid/Soft/Deep) sharing one name, wired through useTheme()'s chartAccent/setChartAccent.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

it('clicking the visible card text selects Deep', () => {
  renderPicker();
  const deepRadio = screen.getByRole('radio', { name: /deep/i }) as HTMLInputElement;
  const deepLabel = deepRadio.closest('label') as HTMLLabelElement;
  const cardText = within(deepLabel).getByText('Deep');
  fireEvent.click(cardText);
  expect(deepRadio.checked).toBe(true);
  expect(localStorage.getItem('glooker-chart-accent')).toBe('deep');
  expect(document.documentElement.getAttribute('data-chart-accent')).toBe('deep');
});

it('accessible names stay exact regardless of selection or theme', () => {
  renderPicker();
  let radios = screen.getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map(r => r.getAttribute('aria-label'))).toEqual(['Vivid', 'Soft', 'Deep']);

  fireEvent.click(screen.getByRole('radio', { name: /deep/i }));
  radios = screen.getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map(r => r.getAttribute('aria-label'))).toEqual(['Vivid', 'Soft', 'Deep']);
});

it('accessible names stay exact under a light theme', () => {
  localStorage.setItem('glooker-theme', 'daylight-blue');
  renderPicker();
  const radios = screen.getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map(r => r.getAttribute('aria-label'))).toEqual(['Vivid', 'Soft', 'Deep']);
});

it('shows "Active" exactly once, on the selected option, and moves it on selection change', () => {
  renderPicker();
  expect(screen.getAllByText('Active')).toHaveLength(1);

  const vividLabel = (screen.getByRole('radio', { name: /vivid/i }) as HTMLInputElement).closest('label') as HTMLLabelElement;
  expect(within(vividLabel).getByText('Active')).toBeTruthy();
  expect(within(vividLabel).getByText('Active').getAttribute('aria-hidden')).toBe('true');

  fireEvent.click(screen.getByRole('radio', { name: /deep/i }));

  expect(screen.getAllByText('Active')).toHaveLength(1);
  const deepLabel = (screen.getByRole('radio', { name: /deep/i }) as HTMLInputElement).closest('label') as HTMLLabelElement;
  expect(within(deepLabel).getByText('Active')).toBeTruthy();
});

it('shows the light-theme Deep note under a light theme, and hides it under dark themes', () => {
  localStorage.setItem('glooker-theme', 'daylight-blue');
  renderPicker();
  const note = screen.getByText('Same as Vivid on light themes');
  expect(note).toBeTruthy();
  expect(note.getAttribute('aria-hidden')).toBe('true');
});

it('hides the light-theme Deep note under the default dark theme', () => {
  renderPicker();
  expect(screen.queryByText('Same as Vivid on light themes')).toBeNull();
});

it('hides the light-theme Deep note under an explicit dark theme', () => {
  localStorage.setItem('glooker-theme', 'amber-glow');
  renderPicker();
  expect(screen.queryByText('Same as Vivid on light themes')).toBeNull();
});
