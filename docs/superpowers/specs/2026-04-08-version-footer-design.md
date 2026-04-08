# Version Footer Design

**Date:** 2026-04-08
**Status:** Approved

## Overview

Add a version footer to every page showing the app version from `package.json` and the short git commit SHA, rendered in document flow at the bottom of the page.

## Format

```
v0.1.0 (abc1234)
```

- When the commit SHA is empty, render only `v0.1.0` (no parentheses).

## Build-time Configuration

In `next.config.ts`, capture version info at config evaluation time and expose as `NEXT_PUBLIC_` environment variables:

- **`NEXT_PUBLIC_APP_VERSION`** — read from `package.json` `version` field
- **`NEXT_PUBLIC_COMMIT_SHA`** — from `execSync('git rev-parse --short HEAD')`, falling back to `""` if git is unavailable

```ts
import { execSync } from 'child_process';
import packageJson from './package.json';

let commitSha = '';
try {
  commitSha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // git not available (e.g., Docker build without .git)
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
  // ... existing config
};
```

## Footer Component

**File:** `src/components/Footer.tsx`

A client component that reads `process.env.NEXT_PUBLIC_APP_VERSION` and `process.env.NEXT_PUBLIC_COMMIT_SHA`.

### Styling

Uses the existing theme approach: dark-first Tailwind utility classes that are automatically remapped by the `[data-theme-mode="light"]` and `@media print` overrides in `globals.css`.

- Text: `text-gray-500` — muted in dark mode, remapped to `#6b7280` in light mode
- Top border: `border-gray-800` — subtle separator, remapped to `#e5e7eb` in light mode
- Small font size: `text-xs`
- Centered, with vertical padding
- No additional CSS rules needed in `globals.css`

### Conditional rendering

- Always shows the version string (`v{version}`)
- Appends ` ({sha})` only when `NEXT_PUBLIC_COMMIT_SHA` is non-empty

## Placement

Added in `src/app/layout.tsx` after `{children}`, inside the `<AuthProvider>` wrapper. Renders in document flow — visible when the user scrolls to the bottom of the page.

```tsx
<body className="bg-[#0F0F0F] text-gray-100 min-h-screen antialiased">
  <ThemeProvider>
    <AuthProvider>
      {children}
      <Footer />
    </AuthProvider>
  </ThemeProvider>
</body>
```

## Files Changed

| File | Change |
|------|--------|
| `next.config.ts` | Add `env` block with `NEXT_PUBLIC_APP_VERSION` and `NEXT_PUBLIC_COMMIT_SHA` |
| `src/components/Footer.tsx` | New client component |
| `src/app/layout.tsx` | Import and render `<Footer />` after `{children}` |
