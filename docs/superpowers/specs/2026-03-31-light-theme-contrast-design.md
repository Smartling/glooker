# Light Theme Contrast Fix

**Date:** 2026-03-31
**Goal:** Make all 4 light themes reasonably readable by fixing contrast-failing color values at the source.

## Problem

Light themes (Daylight Blue, Warm Sand, Fresh Mint, Clean Slate) have severe contrast failures:

- `accentDark` and `accentDarker` CSS variable values are pastel/mid-tone colors that are nearly invisible on light backgrounds (contrast ratios 1.1:1 to 3.4:1)
- `text-gray-500` and `text-gray-600` both map to the same `#9CA3AF` (2.9:1 on white)
- Affected areas: score cards on home page, link text, filter chips, formula text, description text — essentially all accent-colored text in light mode

### Root Cause

The light theme definitions in `themes.ts` invert the accent scale incorrectly. In dark themes, `accentDarker` is the darkest shade (used for subdued borders). In light themes, `accentDarker` was set to pastels like `#93C5FD` and `#FDE68A` — colors that blend into the light background instead of contrasting against it.

## Approach

**Fix at the source** — change the color values in the 4 light theme definitions in `themes.ts` so the accent scale follows the same dark-to-light direction as dark themes. No component file changes needed; the fix flows through the existing CSS variable system.

This was chosen over CSS override or hybrid approaches because:
- It catches both class-based usages (86 across 8 component files) and inline `style={{ color: 'var(--accent-dark)' }}` usages
- Fewer moving parts than adding more CSS rules
- The pastel values are not used decoratively anywhere — they only appear as broken text colors

## Changes

### 1. Light theme color values (`src/app/themes.ts`)

12 values changed across 4 theme objects (accentDark, accentDarker, accentBg per theme):

| Theme | Variable | Current (broken) | New value | Contrast on bodyBg |
|-------|----------|-------------------|-----------|---------------------|
| Daylight Blue | accentDark | `#3B82F6` (3.4:1) | `#1D4ED8` (5.9:1) | AA pass |
| Daylight Blue | accentDarker | `#93C5FD` (2.2:1) | `#1E3A8A` (9.3:1) | AA pass |
| Daylight Blue | accentBg | `#EFF6FF` | `#DBEAFE` | n/a (background) |
| Warm Sand | accentDark | `#D97706` (3.1:1) | `#92400E` (6.4:1) | AA pass |
| Warm Sand | accentDarker | `#FDE68A` (1.2:1) | `#78350F` (8.8:1) | AA pass |
| Warm Sand | accentBg | `#FFFBEB` | `#FEF3C7` | n/a (background) |
| Fresh Mint | accentDark | `#10B981` (2.7:1) | `#047857` (5.5:1) | AA pass |
| Fresh Mint | accentDarker | `#A7F3D0` (1.4:1) | `#065F46` (7.6:1) | AA pass |
| Fresh Mint | accentBg | `#ECFDF5` | `#D1FAE5` | n/a (background) |
| Clean Slate | accentDark | `#818CF8` (3.1:1) | `#4F46E5` (6.1:1) | AA pass |
| Clean Slate | accentDarker | `#C7D2FE` (1.6:1) | `#3730A3` (9.8:1) | AA pass |
| Clean Slate | accentBg | `#EEF2FF` | `#E0E7FF` | n/a (background) |

### 2. Gray text overrides (`src/app/globals.css`)

2 lines changed:

| Selector | Current | New value | Contrast on white |
|----------|---------|-----------|-------------------|
| `text-gray-500` | `#9CA3AF` (2.9:1) | `#6B7280` (4.6:1) | AA pass |
| `text-gray-600` | `#9CA3AF` (2.9:1) | `#4B5563` (7.3:1) | AA pass |

## Out of Scope

- Dark themes — no changes
- Component files — no className changes needed
- Full WCAG AAA compliance
- Print styles — already have separate working overrides
- New CSS variables or theme architecture changes

## Files Touched

1. `src/app/themes.ts` — 12 color value changes
2. `src/app/globals.css` — 2 line changes

## Verification

Visual check: switch to each light theme in the browser and confirm readability on:
- Home page (score cards, "How Impact Score Works" section)
- Settings page (tabs, form labels, configuration cards)
- Any report page with data (developer table, links, filter chips)
