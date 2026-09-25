// GLOOK-58: Recharts' ResponsiveContainer measures its div with getBoundingClientRect() on mount
// and overwrites initialDimension with the result. jsdom returns 0x0, so without this every chart
// test would render an empty container. Call once at the top of a chart test file. It re-applies
// in beforeEach because jest.config.ts has restoreMocks: true, which undoes spies after each test.
export function fixChartSize(width = 640, height = 240): void {
  beforeEach(() => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect,
    );
  });
}
