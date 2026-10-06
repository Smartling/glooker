/**
 * Which build is running.
 *
 * `COMMIT_SHA` is a Docker build-arg/ENV on the *builder* stage only, so it is absent from the
 * runtime image unless the deployment sets it; a runtime value wins when present. The
 * `NEXT_PUBLIC_*` values are inlined by next.config.ts at build time (the full SHA in CI
 * images), which is what the standalone server actually carries. Each must be read as a
 * literal `process.env.NAME` expression or Next will not inline it.
 */
export function getCommit(): string {
  return process.env.COMMIT_SHA || process.env.NEXT_PUBLIC_COMMIT_SHA || 'unknown';
}

// npm_package_version is unset under `node server.js` (no npm in the image), so prefer the
// build-time inlined value.
export function getVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || 'unknown';
}

export function getBuildInfo(): { commit: string; version: string } {
  return { commit: getCommit(), version: getVersion() };
}
