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

  it('fires immediately when tab becomes visible after cooldown', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    act(() => { jest.advanceTimersByTime(6_000); });
    expect(cb).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(24_000); });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('fires immediately on activity after idle period (past cooldown)', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    act(() => { jest.advanceTimersByTime(126_000); });
    expect(cb).toHaveBeenCalledTimes(4);
    cb.mockClear();
    act(() => { document.dispatchEvent(new MouseEvent('mousemove')); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires only once when visibility and activity resume simultaneously', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    act(() => { jest.advanceTimersByTime(126_000); });
    cb.mockClear();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { jest.advanceTimersByTime(30_000); });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new MouseEvent('mousemove'));
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires only once for burst activity events after idle', () => {
    const cb = jest.fn();
    renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    act(() => { jest.advanceTimersByTime(126_000); });
    cb.mockClear();
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove'));
      document.dispatchEvent(new KeyboardEvent('keydown'));
      document.dispatchEvent(new MouseEvent('click'));
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('clears interval and removes listeners on unmount', () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    unmount();
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(cb).not.toHaveBeenCalled();
    act(() => { document.dispatchEvent(new MouseEvent('mousemove')); });
    expect(cb).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels pending debounce timer on unmount', () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useIdleAwarePolling(cb, 30_000, 120_000));
    act(() => { document.dispatchEvent(new MouseEvent('mousemove')); });
    unmount();
    act(() => { jest.advanceTimersByTime(2_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it('does not re-create interval when callback reference changes', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    const { rerender } = renderHook(
      ({ fn }) => useIdleAwarePolling(fn, 30_000, 120_000),
      { initialProps: { fn: cb1 } },
    );
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
    rerender({ fn: cb2 });
    act(() => { jest.advanceTimersByTime(30_000); });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
