// src/components/filter-chip.tsx
// A removable filter chip, styled as the Projects / Team / Settings chips. Only the Security tab uses it so far;
// moving those pages onto it is a separate change.
'use client';
import type { Ref } from 'react';

export interface FilterChipProps {
  label: string;
  onRemove: () => void;
  /** px; a longer label is cut with "…" and keeps its full text in a title. */
  maxWidth?: number;
  title?: string;
  removeRef?: Ref<HTMLButtonElement>;
}

export default function FilterChip({ label, onRemove, maxWidth, title, removeRef }: FilterChipProps) {
  return (
    <span
      data-testid="filter-chip"
      className="inline-flex min-w-0 shrink items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30"
      style={maxWidth ? { maxWidth } : undefined}
    >
      <span className="truncate" title={title ?? label}>{label}</span>
      <button
        type="button" ref={removeRef} onClick={onRemove} aria-label={`Remove ${label} filter`}
        className="shrink-0 text-accent-light hover:text-white ml-0.5"
      >
        &times;
      </button>
    </span>
  );
}
