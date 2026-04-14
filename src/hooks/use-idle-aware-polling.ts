import { useEffect, useRef } from 'react';

const COOLDOWN = 5_000;
const ACTIVITY_DEBOUNCE = 1_000;

export function useIdleAwarePolling(
  callback: () => void,
  intervalMs: number,
  idleTimeoutMs: number,
): void {
  const callbackRef = useRef(callback);
  const lastActiveRef = useRef(Date.now());
  const lastFiredRef = useRef(Date.now());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Keep callback ref current
  callbackRef.current = callback;

  useEffect(() => {
    const fire = () => {
      callbackRef.current();
      lastFiredRef.current = Date.now();
    };

    const onActivity = () => {
      const now = Date.now();
      const wasIdle = now - lastActiveRef.current > idleTimeoutMs;
      if (wasIdle && now - lastFiredRef.current > COOLDOWN) {
        fire();
      }
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        lastActiveRef.current = Date.now();
      }, ACTIVITY_DEBOUNCE);
    };

    const onVisibility = () => {
      if (!document.hidden && Date.now() - lastFiredRef.current > COOLDOWN) {
        lastActiveRef.current = Date.now();
        fire();
      }
    };

    const intervalId = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActiveRef.current > idleTimeoutMs) return;
      fire();
    }, intervalMs);

    const activityEvents = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    activityEvents.forEach(evt =>
      document.addEventListener(evt, onActivity, { passive: true }),
    );
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(intervalId);
      clearTimeout(debounceTimerRef.current);
      activityEvents.forEach(evt =>
        document.removeEventListener(evt, onActivity),
      );
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, idleTimeoutMs]);
}
