/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useIdleAwarePolling } from '@/hooks/use-idle-aware-polling';

describe('useIdleAwarePolling', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not fire callback immediately on mount', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    expect(cb).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires callback every intervalMs when tab is visible and user is active', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).toHaveBeenCalledTimes(2);
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('skips callback when document is hidden', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('skips callback when user has been idle beyond the threshold', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    act(() => { jest.advanceTimersByTime(120_000); });
    expect(cb).toHaveBeenCalledTimes(4);
    cb.mockClear();
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb).not.toHaveBeenCalled();
  });
});
