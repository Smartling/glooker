import fs from 'fs';
import path from 'path';

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

describe('logger enforcement', () => {
  it('all API route files import withRequestLog', () => {
    const routeFiles = findRouteFiles(path.join('src', 'app', 'api'));
    expect(routeFiles.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (!content.includes('withRequestLog')) {
        missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });
});
