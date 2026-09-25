// GLOOK-58: jsdom has no ResizeObserver. Recharts' ResponsiveContainer skips its size detector
// entirely without one, so any test that renders a chart (including the vuln-content-* tests that
// render VulnerabilitiesContent with the real TrendChart) needs this stub. Guarded so node-env
// suites are untouched. The stub never fires: sizing in chart tests comes from fixChartSize().
if (typeof window !== 'undefined' && typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

export {};
