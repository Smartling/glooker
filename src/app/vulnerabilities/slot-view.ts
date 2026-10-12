// src/app/vulnerabilities/slot-view.ts
// GLOOK-64: the one rule for how an Overview section reads a data slot. The team table, the repository
// table, the trend card, the sparkline and the ownership card's tab counts all decide with this, so a
// failed refresh or an unavailable answer reads the same everywhere. Client-safe: no React, no server imports.
import type { Slot } from './api-types';

/** The small red note next to figures that are still on screen after a refresh of the same request failed. */
export const REFRESH_FAILED_NOTE = "Couldn't refresh · showing last load";
/** The short text where a section's request answered `available: false`. */
export const UNAVAILABLE_TEXT = 'Not available yet';

export type SlotView<T> =
  /** The slot has data of its own. `dimmed`: it is the previous key's (a new key is loading). `refreshError`: the same key failed to refresh. */
  | { kind: 'data'; data: T; dimmed: boolean; refreshError: string | null }
  | { kind: 'error'; text: string }
  | { kind: 'loading' }
  /** `title` is the server's reason, for a tooltip. */
  | { kind: 'unavailable'; text: string; title: string };

/**
 * Own data wins over everything: good figures are never thrown away for a later error. Without data, an
 * error is the answer; then an `available: false` reply; anything else is still loading.
 */
export function slotView<T>(slot: Slot<T>): SlotView<T> {
  if (slot.data !== undefined) return { kind: 'data', data: slot.data, dimmed: slot.stale, refreshError: slot.errorText };
  if (slot.errorText) return { kind: 'error', text: slot.errorText };
  if (slot.unavailable) return { kind: 'unavailable', text: UNAVAILABLE_TEXT, title: slot.unavailable.reason };
  return { kind: 'loading' };
}
