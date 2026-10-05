/**
 * Content-Security-Policy, built per request.
 *
 * script-src cannot be a static 'self': Next's App Router bootstraps hydration with
 * inline <script> tags (`self.__next_f.push(...)`, the React Server Components
 * payload), so a static 'self' policy blocks them and the client app never
 * hydrates (React error #412, a page of static HTML with no data). Instead
 * proxy.ts mints a fresh nonce for every request and passes this policy on the
 * request headers; Next reads the nonce from there and stamps it on its own
 * scripts. Injected markup can't guess the nonce, so an injected handler or
 * <script> is still blocked — the protection 'unsafe-inline' would have given up.
 * 'strict-dynamic' lets those trusted scripts load the chunk files they import.
 *
 * Other notes:
 *   - 'unsafe-inline' is required in style-src: Recharts emits inline styles and
 *     components/charts/chart.tsx injects a <style> block of CSS variables.
 *   - img-src must allow avatars.githubusercontent.com — developer_stats
 *     .avatar_url is rendered throughout the dashboards.
 */
export function buildCsp(nonce: string, opts: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' only in development: React's dev build uses eval for stack frames.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** A fresh, unguessable nonce (128 bits, base64). */
export function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
}
