// src/app/vulnerabilities/sla-invalid-mark.tsx
// GLOOK-64: the red "!" that accompanies "SLA policy can't be read" wherever it is drawn (the Alerts strip, the rail's footer
// note, the list's Due sub-line and toggle hint), so the state never rests on colour alone. Decorative: the words carry the meaning.
export default function SlaInvalidMark() {
  return (
    <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-red-400 align-middle text-[10px] font-bold leading-none text-gray-900">!</span>
  );
}
