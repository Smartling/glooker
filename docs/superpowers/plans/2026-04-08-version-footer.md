# Version Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a version footer showing `v{version} ({commitSha})` to every page, with build-time commit SHA injection and theme-aware styling.

**Architecture:** `next.config.ts` captures the git SHA and package version at build time via `NEXT_PUBLIC_` env vars. A new `Footer` client component reads those env vars and renders in document flow at the bottom of the root layout.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS, Node `child_process`

---

## File Structure

| File | Role |
|------|------|
| `next.config.ts` | Modified — add `execSync` for git SHA, import `package.json` version, expose both as `NEXT_PUBLIC_` env vars |
| `src/components/Footer.tsx` | New — client component rendering version + optional commit SHA |
| `src/app/layout.tsx` | Modified — import and render `<Footer />` after `{children}` |

---

### Task 1: Add build-time env vars to next.config.ts

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Add git SHA and version env vars**

Replace the full contents of `next.config.ts` with:

```ts
import type { NextConfig } from 'next';
import { execSync } from 'child_process';

const pkg = require('./package.json');

let commitSha = '';
try {
  commitSha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // git not available (e.g., Docker build without .git)
}

const nextConfig: NextConfig = {
  serverExternalPackages: ['mysql2', 'better-sqlite3', 'croner'],
  outputFileTracingIncludes: {
    '/**': ['./prompts/**'],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
};

export default nextConfig;
```

Note: We use `require('./package.json')` instead of `import` because `next.config.ts` is evaluated by Next.js's own loader where top-level JSON imports can be unreliable. `require` is the standard pattern used in Next.js config files.

- [ ] **Step 2: Verify the config loads**

Run: `cd /Users/maes/Documents/1macmount/code/glooker && npx next info`

Expected: Command completes without errors, showing Next.js environment info. This confirms `next.config.ts` parses correctly with the new imports.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat: expose app version and commit SHA as build-time env vars"
```

---

### Task 2: Create the Footer component

**Files:**
- Create: `src/components/Footer.tsx`

- [ ] **Step 1: Create the components directory and Footer component**

Create `src/components/Footer.tsx` with:

```tsx
'use client';

export default function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;

  return (
    <footer className="border-t border-gray-800 py-4 text-center text-xs text-gray-500">
      v{version}{sha ? ` (${sha})` : ''}
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Footer.tsx
git commit -m "feat: add version Footer component"
```

---

### Task 3: Wire Footer into root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Import Footer and render after children**

In `src/app/layout.tsx`, add the import at the top with the other imports:

```ts
import Footer from '@/components/Footer';
```

Then update the `<body>` JSX to include `<Footer />` after `{children}`:

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

- [ ] **Step 2: Verify visually**

Run: `cd /Users/maes/Documents/1macmount/code/glooker && npm run dev`

Open `http://localhost:3000` in the browser. Scroll to the bottom of the page.

Expected:
- A subtle top-bordered footer appears at the bottom of the page content
- Shows `v0.1.0 (abc1234)` (where `abc1234` is the current short SHA)
- Toggle to light theme — the footer text and border adapt automatically via the existing `globals.css` overrides

- [ ] **Step 3: Run existing tests**

Run: `cd /Users/maes/Documents/1macmount/code/glooker && npm test`

Expected: All existing tests pass. The footer is a client component not imported by any `src/lib` code, so no tests should be affected.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: render version footer in root layout"
```
