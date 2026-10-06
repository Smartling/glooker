/**
 * package-lock.json must resolve every package from the public npm registry.
 * A developer whose ~/.npmrc points at a private registry silently writes that
 * registry into `resolved`, and every clean install outside that network then
 * fails (CI, Docker builds, contributors). Checked in CI.
 */
export function findForeignResolved(lock: unknown, allowedPrefix = 'https://registry.npmjs.org/'): string[] {
  const packages = (lock as { packages?: Record<string, { resolved?: unknown }> })?.packages;
  if (!packages || typeof packages !== 'object') {
    throw new Error('not a package-lock.json: no "packages" map');
  }
  const foreign: string[] = [];
  for (const [path, entry] of Object.entries(packages)) {
    const resolved = entry?.resolved;
    if (typeof resolved === 'string' && !resolved.startsWith(allowedPrefix)) {
      foreign.push(`${path} -> ${resolved}`);
    }
  }
  return foreign;
}
