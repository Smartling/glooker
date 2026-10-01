/** @jest-environment jsdom */
// src/lib/__tests__/unit/chart-accent-pref.test.ts
// GLOOK-58 Decision 16: the chart-accent preference (Vivid/Soft/Deep) persisted in localStorage
// under 'glooker-chart-accent', mirroring the theme preference's get/save/apply shape in
// themes.ts. A missing, unknown or unreadable value always falls back to 'vivid'.
import { applyChartAccent, getSavedChartAccent, saveChartAccent } from '@/app/themes';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-chart-accent');
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('saves and reads back a chart accent choice', () => {
  saveChartAccent('soft');
  expect(getSavedChartAccent()).toBe('soft');
});

it('a missing key defaults to vivid', () => {
  expect(getSavedChartAccent()).toBe('vivid');
});

it('an unknown stored value defaults to vivid', () => {
  localStorage.setItem('glooker-chart-accent', 'loud');
  expect(getSavedChartAccent()).toBe('vivid');
});

it('a throwing getItem defaults to vivid', () => {
  const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(getSavedChartAccent()).toBe('vivid');
  expect(spy).toHaveBeenCalled();
});

it('a throwing setItem does not throw', () => {
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => saveChartAccent('soft')).not.toThrow();
  expect(spy).toHaveBeenCalled();
});

it('applyChartAccent sets data-chart-accent on <html>', () => {
  applyChartAccent('soft');
  expect(document.documentElement.getAttribute('data-chart-accent')).toBe('soft');
});
