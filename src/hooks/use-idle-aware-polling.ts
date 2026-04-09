import { useEffect, useRef } from 'react';

const COOLDOWN = 5_000;

export function useIdleAwarePolling(
  callback: () => void,
  intervalMs: number,
  idleTimeoutMs: number,
): void {
  const callbackRef = useRef(callback);
  const lastActiveRef = useRef(Date.now());
  const lastFiredRef = useRef(Date.now());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Keep callback ref current
  callbackRef.current = callback;

  useEffect(() => {
    const fire = () => {
      callbackRef.current();
      lastFiredRef.current = Date.now();
    };

    const intervalId = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActiveRef.current > idleTimeoutMs) return;
      fire();
    }, intervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [intervalMs, idleTimeoutMs]);
}
