# DESIGN.md — Visual System & Design Language (T-69)

**Project:** Merchant-Agent — Autonomous Merchandising Engine & Storefront  
**Scope:** Storefront (`/`, `/browse`), Audit Trail (`/audit`), Control Panel (`/control`), Policy Inspector (`/policy`).  
**Design Philosophy:** Modern, rich, glassmorphic editorial aesthetic balancing high-end Indian indie bookstore warmth with real-time autonomous operational clarity.

---

## 1. Brand Identity & Theme Tokens

### Color Palette (Tailored HSL Design Tokens)

```css
:root {
  /* Brand Warmth / E-commerce Accent */
  --color-brand-primary: hsl(24, 85%, 52%);       /* Terracotta Amber #E06D24 */
  --color-brand-accent:  hsl(38, 92%, 50%);       /* Golden Saffron #F5A623 */
  --color-brand-deep:    hsl(20, 70%, 25%);       /* Deep Mahogany #6D2E14 */

  /* Neutral Dark Mode (Surface Base) */
  --color-bg-base:        hsl(220, 20%, 10%);      /* Slate Ebony #14171F */
  --color-bg-surface:     hsl(220, 18%, 14%);      /* Dark Slate Card #1C212D */
  --color-bg-glass:       hsla(220, 18%, 14%, 0.75);/* Glassmorphism Surface */
  --color-bg-elevated:    hsl(220, 16%, 18%);      /* Elevated Card/Popover */

  /* Text & Typography Colors */
  --color-text-primary:   hsl(210, 20%, 98%);      /* Warm White #FAFBFC */
  --color-text-secondary: hsl(215, 15%, 70%);      /* Muted Slate #A0AEC0 */
  --color-text-muted:     hsl(215, 12%, 48%);      /* Dim Subtext #64748B */

  /* Status Tokens (Audit & Policy Verdicts) */
  --color-status-success: hsl(152, 68%, 45%);      /* Emerald Green #22C55E (APPROVED/EXECUTED) */
  --color-status-error:   hsl(350, 84%, 60%);      /* Crimson Red #EF4444 (REJECTED/BLOCKED) */
  --color-status-warning: hsl(38, 92%, 50%);       /* Amber Saffron #F5A623 (RETRY/DEGRADED) */
  --color-status-info:    hsl(200, 85%, 53%);      /* Sky Blue #38BDF8 (OBSERVE/SIGNAL) */

  /* Borders & Dividers */
  --color-border-subtle:  hsla(215, 15%, 25%, 0.5);
  --color-border-bright:  hsla(24, 85%, 52%, 0.4);
  --color-border-danger:  hsla(350, 84%, 60%, 0.5);

  /* Shadows & Glassmorphism Glows */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.25);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.45);
  --glow-emerald: 0 0 20px rgba(34, 197, 94, 0.25);
  --glow-crimson: 0 0 20px rgba(239, 68, 68, 0.35);
  --glow-amber: 0 0 20px rgba(224, 109, 36, 0.30);
}
```

---

## 2. Typography Hierarchy

Using Google Fonts: **Outfit** (Display / Headings), **Inter** (UI Body & Data Tables), **JetBrains Mono** (Policy Rule IDs & Telemetry).

- **Heading XL (Hero Title):** `Outfit`, 40px / 1.15, Weight 700
- **Heading Large (Section Titles):** `Outfit`, 28px / 1.2, Weight 600
- **Heading Medium (Card Header):** `Outfit`, 20px / 1.3, Weight 600
- **Body Regular:** `Inter`, 15px / 1.5, Weight 400
- **Body Small:** `Inter`, 13px / 1.4, Weight 400
- **Code / Rule Monospace:** `JetBrains Mono`, 13px / 1.4, Weight 500

---

## 3. Shared Navigation & Page Layouts

All four surfaces share a sticky, glassmorphic header bar:

```
[ 📚 MERCHANT-AGENT ]   [ Storefront ]   [ Audit Log ]   [ Control Panel ]   [ Policy Engine ]   [ Day 8 / Active ]
```

---

## 4. Component Vocabulary Across Surfaces

### A. Storefront (`/`, `/browse`)
- **Hero Carousel Banner:** Featured book rank #1 with active discount pill and live stock pill.
- **Product Card Grid:** Book cover mockup, title, author, category badge, stock level (`42 in stock` or `Low Stock: 3 left`).
- **Discount Badge:** Original price struck through `~~₹499~~` with new price `₹409` in bold Emerald Green, accompanied by `-18% OFF` badge.
- **Filter Tabs:** Category chips (`All`, `Fiction`, `Travel`, `Wellness`, `Sports`, `Thriller`, `Gift`, `Nature`).

### B. Audit Log (`/audit`) — Flagship Judging Page
- **Run Header Banner:** Trigger badge (`INTERNAL`, `EXTERNAL`, `AI_BUYER`), Day Index, Status Badge (`EXECUTED`, `REJECTED`, `FAILED`).
- **Prominent Rejection Callout (The Submission Centrepiece):**
  - Crimson glowing banner: `❌ REJECTED BY POLICY ENGINE`
  - Rule ID pill: `MAX_DISCOUNT_PCT`
  - Proposed vs Limit: `Proposed: 30%` | `Merchant Ceiling: 20%`
  - Subtext: *Model was never disclosed the limit. Action refused by server-side policy.*
- **Retry Turn Section:** `Retry (1 of 1)` badge with updated proposal (`18%`) and approval verdict.
- **Narrative Story Block:** Clean, human-readable prose without raw JSON.

### C. Control Panel (`/control`)
- **Simulation Clock Widget:** Large Day Counter (`Day 8 of 8`).
- **Action Buttons Grid:**
  - `[ ⏩ Advance Day ]` (Primary Amber)
  - `[ 🔍 Run Internal Cycle ]` (Emerald Green)
  - `[ 🌐 Run External Cycle ]` (Sky Blue)
  - `[ 🔄 Reset Simulation ]` (Secondary Muted)
- **Live Cycle Terminal Stream:** Real-time log output of cycle execution.

### D. Policy Inspector (`/policy`)
- **Merchant Limits Table:** Read-only cards for `merchant_policy`:
  - `MAX_DISCOUNT_PCT`: `20%` (Maximum single product discount)
  - `MIN_MARGIN_PCT`: `15%` (Minimum gross margin percentage)
  - `MAX_ACTIVE_DISCOUNTS`: `3` (Concurrent storewide discounts)
  - `DAILY_DISCOUNT_BUDGET`: `₹5,000` (Daily price reduction ceiling)
  - `STOCK_FLOOR`: `5 units` (Do not discount if inventory < 5)

---

## 5. Implementation Roadmap for Phase 7 UI Tasks

1. **`app/globals.css` (T-69):** Inject shared CSS variables, typography imports, glassmorphism utilities, and keyframe animations.
2. **`components/Navbar.tsx` (T-69):** Global navigation header with active indicator and day badge.
3. **`app/page.tsx` & `/browse` (T-70):** Public storefront with live Supabase data, struck-through prices, and discount badges.
4. **`app/audit/page.tsx` (T-71):** Flagship Audit Trail page with high-visibility rejection callouts and narrative rendering.
5. **`app/control/page.tsx` (T-73):** Interactive control panel for camera-ready demo execution.
6. **`app/policy/page.tsx` (T-72):** Merchant Policy inspector mapping rule IDs to database limits.
