// src/app/vulnerabilities/bang-mark.tsx
// GLOOK-64: the red "!" that marks a state that is wrong, so it never rests on colour alone: "SLA policy can't be read" (the Alerts
// strip, the rail's footer note, the list's Due sub-line and toggle hint) and a failed refresh on the strip. Decorative: the words
// (or, for the strip's stale cue, the title) carry the meaning, so it is always aria-hidden.
export default function BangMark({ title, testId }: { title?: string; testId?: string }) {
  return (
    <span aria-hidden="true" data-testid={testId} title={title} className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-400 align-middle text-[10px] font-bold leading-none text-gray-900">!</span>
  );
}
