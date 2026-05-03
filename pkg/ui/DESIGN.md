---
title: Design System
description: Linear-inspired theme system for Flowlib UI components.
---

# Design System — Linear-Inspired Theme for Flowlib

## 1. Visual Theme & Atmosphere

A dark-mode-first design language where content emerges from darkness with surgical precision. The overall impression is one of extreme precision engineering: every element exists in a carefully calibrated hierarchy of luminance, managed through subtle gradations of opacity rather than color variation.

This document maps that vision onto Flowlib's `fl-*` token system, `.flowlib` CSS scope, Tailwind utility classes, and component architecture (CVA variants, Radix primitives, shadcn/ui foundation).

### Core Design Principles

- **Dark-native**: The default experience is dark. Light mode is derived, not the other way around.
- **Achromatic UI chrome**: Interface elements are grayscale. Color is reserved for semantics (status) and a single brand accent.
- **Luminance-as-elevation**: Depth is communicated through background brightness steps (`0.02 → 0.04 → 0.05` opacity increments), not traditional shadows on dark surfaces.
- **Compressed density at scale**: Display typography uses aggressive negative letter-spacing; body text breathes with relaxed line-height.
- **Semi-transparent borders**: Structure is created with whisper-thin `rgba(255,255,255,0.05–0.08)` borders — wireframes drawn in moonlight.

---

## 2. Color Palette — `fl-*` Token Mapping

All values are set via `--fl-*` CSS custom properties in [pkg/ui/src/app.css](../../pkg/ui/src/app.css). The `.flowlib` scope activates them; `.flowlib.dark` applies the dark overrides.

### Dark Mode (Primary Experience)

#### Background Surfaces

| Role                | Token                    | New Value | Tailwind Class  | Notes                                                  |
| ------------------- | ------------------------ | --------- | --------------- | ------------------------------------------------------ |
| Page background     | `--fl-background`        | `#0a0a0c` | `bg-background` | Near-black with cool undertone. The canvas.            |
| Canvas (React Flow) | `--fl-canvas-background` | `#0f0f12` | —               | Flow editor surface, one step up.                      |
| Card / Panel        | `--fl-card`              | `#141418` | `bg-card`       | Elevated surface. Translucent feel via subtle borders. |
| Popover / Dropdown  | `--fl-popover`           | `#191a1f` | `bg-popover`    | Floating surfaces, slightly brighter than cards.       |
| Secondary surface   | `--fl-secondary`         | `#1a1a22` | `bg-secondary`  | Hover states, slightly elevated components.            |
| Muted / Disabled    | `--fl-muted`             | `#1a1a22` | `bg-muted`      | De-emphasized areas, disabled control backgrounds.     |
| Accent highlight    | `--fl-accent`            | `#1e1e2a` | `bg-accent`     | Selected/active item backgrounds.                      |
| Sidebar             | `--fl-sidebar`           | `#0a0a0c` | `bg-sidebar`    | Matches page background for seamless integration.      |

#### Text & Content

| Role           | Token                     | New Value | Tailwind Class            | Notes                                              |
| -------------- | ------------------------- | --------- | ------------------------- | -------------------------------------------------- |
| Primary text   | `--fl-foreground`         | `#f0f1f3` | `text-foreground`         | Near-white, not pure `#fff` — prevents eye strain. |
| Card text      | `--fl-card-foreground`    | `#f0f1f3` | `text-card-foreground`    | Matches primary.                                   |
| Secondary text | `--fl-muted-foreground`   | `#8a8f98` | `text-muted-foreground`   | Muted gray for descriptions, metadata.             |
| Sidebar text   | `--fl-sidebar-foreground` | `#f0f1f3` | `text-sidebar-foreground` | —                                                  |

#### Brand & Accent

| Role                | Token                            | New Value | Tailwind Class                   | Notes                                      |
| ------------------- | -------------------------------- | --------- | -------------------------------- | ------------------------------------------ |
| Primary accent      | `--fl-primary`                   | `#7170ff` | `bg-primary`, `text-primary`     | Indigo-violet. Interactive elements, CTAs. |
| Primary on-color    | `--fl-primary-foreground`        | `#ffffff` | `text-primary-foreground`        | White text on primary backgrounds.         |
| Ring / Focus        | `--fl-ring`                      | `#7170ff` | `ring-ring`                      | Focus indicators match primary.            |
| Sidebar accent bg   | `--fl-sidebar-accent`            | `#1e1e2a` | `bg-sidebar-accent`              | Active sidebar item highlight.             |
| Sidebar accent text | `--fl-sidebar-accent-foreground` | `#7170ff` | `text-sidebar-accent-foreground` | Accent-colored active sidebar text.        |

#### Border & Divider

| Role           | Token                 | New Value                | Tailwind Class          | Notes                                                    |
| -------------- | --------------------- | ------------------------ | ----------------------- | -------------------------------------------------------- |
| Default border | `--fl-border`         | `rgba(255,255,255,0.08)` | `border-border`         | Semi-transparent white. The default for cards, sections. |
| Input border   | `--fl-input`          | `rgba(255,255,255,0.10)` | `border-input`          | Slightly more visible for form controls.                 |
| Sidebar border | `--fl-sidebar-border` | `rgba(255,255,255,0.06)` | `border-sidebar-border` | Subtler for nav chrome.                                  |

#### Semantic / Status Colors

| Role          | Token                | Value     | Tailwind                     |
| ------------- | -------------------- | --------- | ---------------------------- |
| Success       | `--fl-success`       | `#3dd68c` | `bg-success`, `text-success` |
| Success muted | `--fl-success-muted` | `#1a3a2a` | `bg-success-muted`           |
| Warning       | `--fl-warning`       | `#f5c518` | `bg-warning`, `text-warning` |
| Warning muted | `--fl-warning-muted` | `#3a3000` | `bg-warning-muted`           |
| Info          | `--fl-info`          | `#60a5fa` | `bg-info`, `text-info`       |
| Info muted    | `--fl-info-muted`    | `#1e3a5f` | `bg-info-muted`              |
| Destructive   | `--fl-destructive`   | `#e5484d` | `bg-destructive`             |

#### Shadows

On dark surfaces, traditional shadows (dark-on-dark) are nearly invisible. Elevation is communicated primarily through background luminance stepping. Shadows reinforce depth at floating layers only.

| Token                    | Value                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| `--fl-shadow-card`       | `0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)`                |
| `--fl-shadow-card-hover` | `0 4px 12px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.2)`               |
| `--fl-shadow-floating`   | `0 16px 48px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)` |
| `--fl-shadow-sidebar`    | `1px 0 3px rgba(0,0,0,0.3)`                                           |
| `--shadow-opacity`       | `0.25`                                                                |
| `--shadow-color`         | `#000000`                                                             |

#### Flow Editor

| Token                    | Value                | Notes                        |
| ------------------------ | -------------------- | ---------------------------- |
| `--edge-selected-stroke` | `#7170ff`            | Matches primary accent.      |
| `--node-selected-border` | `#60a5fa`            | Blue selection ring.         |
| `--node-hover-bg`        | `rgba(25,26,31,0.8)` | Translucent hover highlight. |

#### Charts

```
--chart-1: #7170ff  (primary indigo)
--chart-2: #9b9be8  (lighter indigo)
--chart-3: #5a7de8  (blue)
--chart-4: #3dd68c  (green)
--chart-5: #ff6369  (red)
```

---

### Light Mode (Derived)

Light mode inverts the luminance hierarchy while preserving the same accent and semantic colors.

| Token                    | Light Value | Notes                                         |
| ------------------------ | ----------- | --------------------------------------------- |
| `--fl-background`        | `#fafafa`   |                                               |
| `--fl-canvas-background` | `#f8f9fb`   |                                               |
| `--fl-foreground`        | `#1a1a2e`   |                                               |
| `--fl-card`              | `#ffffff`   |                                               |
| `--fl-primary`           | `#5b5bd6`   | Slightly desaturated for legibility on white. |
| `--fl-muted-foreground`  | `#6e6e80`   |                                               |
| `--fl-border`            | `#e0e0ec`   | Solid light gray-blue.                        |
| `--fl-input`             | `#dcdce4`   |                                               |
| `--fl-ring`              | `#5b5bd6`   |                                               |

Full light-mode token list remains in [app.css](../../pkg/ui/src/app.css) — the `.flowlib` base scope (before `.dark`).

---

## 3. Typography

### Font Stack

| Role            | Font           | Tailwind    | CSS Variable  |
| --------------- | -------------- | ----------- | ------------- |
| **UI text**     | Geist Variable | `font-sans` | `--font-sans` |
| **Code / mono** | Iosevka        | `font-mono` | `--font-mono` |

Geist Variable is loaded at **weight 100–900** (variable font). Iosevka is loaded at **weight 400**.

### Type Scale

Flowlib uses Tailwind's default type scale. In this Linear-inspired direction, the following specific treatments apply:

| Role         | Tailwind Classes                        | Size            | Weight  | Letter Spacing | Notes                                |
| ------------ | --------------------------------------- | --------------- | ------- | -------------- | ------------------------------------ |
| Display XL   | `text-7xl font-medium tracking-tighter` | 4.5rem (72px)   | 500     | -0.05em        | Hero headlines. Maximum compression. |
| Display      | `text-5xl font-medium tracking-tighter` | 3rem (48px)     | 500     | -0.04em        | Section headlines.                   |
| Heading 1    | `text-3xl tracking-tight`               | 1.875rem (30px) | 400     | -0.025em       | Page titles.                         |
| Heading 2    | `text-2xl font-semibold tracking-tight` | 1.5rem (24px)   | 600     | -0.015em       | Section titles.                      |
| Heading 3    | `text-xl font-semibold`                 | 1.25rem (20px)  | 600     | normal         | Card headers, feature titles.        |
| Body Large   | `text-lg`                               | 1.125rem (18px) | 400     | normal         | Intro text, descriptions.            |
| Body         | `text-base`                             | 1rem (16px)     | 400     | normal         | Standard reading text.               |
| Body Medium  | `text-base font-medium`                 | 1rem (16px)     | 500     | normal         | Navigation, labels.                  |
| Small        | `text-sm`                               | 0.875rem (14px) | 400     | normal         | Secondary text, metadata.            |
| Small Medium | `text-sm font-medium`                   | 0.875rem (14px) | 500     | normal         | Emphasized small text.               |
| Caption      | `text-xs`                               | 0.75rem (12px)  | 400–500 | normal         | Timestamps, tiny labels.             |
| Code Body    | `font-mono text-sm`                     | 0.875rem (14px) | 400     | normal         | Code blocks, technical values.       |
| Code Label   | `font-mono text-xs`                     | 0.75rem (12px)  | 400     | normal         | Code metadata.                       |

### Typography Principles

- **`font-medium` (500) as the emphasis weight**: Use for navigation, labels, interactive text. The subtle step above 400 creates emphasis without heaviness.
- **`font-semibold` (600) for strong emphasis**: Headings, section titles, button text.
- **Compression at scale**: Display sizes use `tracking-tighter` (-0.05em). Below `text-xl`, tracking returns to normal.
- **Three-tier weight system**: 400 (reading), 500 (emphasis/UI), 600 (strong emphasis). Rarely use 700.

---

## 4. Component Styling Patterns

All Flowlib components use [class-variance-authority (CVA)](https://cva.style/docs) for variant management and are built on shadcn/ui + Radix primitives. Styles use Tailwind classes referencing `fl-*` tokens.

### Buttons

Defined in `pkg/ui/src/components/ui/button.tsx` via `buttonVariants`. For the Linear-inspired dark theme:

| Variant       | Key Classes                                                    | Description                                                      |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `default`     | `bg-primary text-primary-foreground hover:bg-primary/90`       | Brand indigo CTA. Used sparingly.                                |
| `outline`     | `border bg-background shadow-xs hover:bg-accent`               | Ghost/outline. Near-transparent bg with semi-transparent border. |
| `secondary`   | `bg-secondary text-secondary-foreground hover:bg-secondary/80` | Subtle elevated button.                                          |
| `ghost`       | `hover:bg-accent hover:text-accent-foreground`                 | No background until hover. Toolbar actions.                      |
| `destructive` | `bg-destructive text-white hover:bg-destructive/90`            | Danger actions.                                                  |
| `link`        | `text-primary underline-offset-4 hover:underline`              | Inline link styling.                                             |

**Button sizing**: `sm` (h-8), `default` (h-9), `lg` (h-10), `icon` (size-9 square).

**Dark-theme button feel**: Buttons should feel like they emerge from the surface — near-transparent backgrounds with semi-transparent borders, brightening slightly on hover. The `default` (primary) variant is the only solid-color button.

### Cards & Containers

```tsx
<Card className="bg-card border border-border rounded-xl shadow-[var(--fl-shadow-card)]">
  <CardHeader>
    <CardTitle className="text-foreground font-semibold">Title</CardTitle>
    <CardDescription className="text-muted-foreground">Description</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

Key properties:

- Background: `bg-card` (token resolves to translucent-feeling dark surface)
- Border: `border border-border` (semi-transparent white in dark mode)
- Radius: `rounded-xl` (12px) for cards, `rounded-lg` (8px) for smaller containers
- Shadow: `--fl-shadow-card` for resting, `--fl-shadow-card-hover` on hover
- Hover: subtle background opacity increase via `hover:bg-accent`

### Inputs & Forms

```tsx
<Input className="bg-background text-foreground border-input placeholder:text-muted-foreground rounded-md" />
```

- Background: transparent or `bg-background` (darkest layer)
- Border: `border-input` (semi-transparent white, slightly brighter than card border)
- Text: `text-foreground` (near-white)
- Placeholder: `text-muted-foreground` (muted gray)
- Radius: `rounded-md` (6px)
- Focus: `focus-visible:ring-ring/50 focus-visible:ring-[3px]`

### Badges & Pills

```tsx
<Badge
  variant="outline"
  className="border-border text-muted-foreground text-xs font-medium rounded-full"
>
  Status
</Badge>
```

- **Outline badge**: transparent bg, semi-transparent border, muted text, `rounded-full` (pill shape)
- **Success badge**: `bg-success text-success-foreground rounded-full`
- **Subtle badge**: `bg-muted text-muted-foreground rounded-sm`

### Navigation / Sidebar

- Background: `bg-sidebar` (matches page background for seamless look)
- Border right: `border-sidebar-border` (barely-visible divider)
- Shadow: `--fl-shadow-sidebar` (subtle vertical light)
- Links: `text-sm font-medium text-sidebar-foreground`
- Active item: `bg-sidebar-accent text-sidebar-accent-foreground`
- Hover: `hover:bg-sidebar-accent/50`

---

## 5. Layout & Spacing

### Spacing System

Flowlib uses Tailwind's default 4px-based spacing scale:

| Tailwind       | Pixels | Use                            |
| -------------- | ------ | ------------------------------ |
| `gap-1`, `p-1` | 4px    | Tight spacing, inline elements |
| `gap-2`, `p-2` | 8px    | Component internal padding     |
| `gap-3`, `p-3` | 12px   | Comfortable padding            |
| `gap-4`, `p-4` | 16px   | Standard content padding       |
| `gap-6`, `p-6` | 24px   | Section padding                |
| `gap-8`, `p-8` | 32px   | Large section breaks           |

### Border Radius Scale

Defined as CSS custom properties in the `@theme inline` block:

| Tailwind       | Token         | Value  | Use                                  |
| -------------- | ------------- | ------ | ------------------------------------ |
| `rounded-sm`   | `--radius-sm` | 4px    | Inline badges, toolbar buttons       |
| `rounded-md`   | `--radius-md` | 6px    | Buttons, inputs, functional elements |
| `rounded-lg`   | `--radius-lg` | 8px    | Standard containers, dropdowns       |
| `rounded-xl`   | `--radius-xl` | 12px   | Cards, panels, featured containers   |
| `rounded-full` | —             | 9999px | Pills, chips, avatars, status dots   |

### Layout Patterns

- **Page structure**: Sidebar (`bg-sidebar`) + main content area (`bg-background`)
- **Flow editor**: Full canvas (`bg-canvas-background`) with floating panels
- **Config panels**: Slide-over or dialog with `bg-card` background and `--fl-shadow-floating`
- **Section separation**: Generous vertical padding (`py-8` to `py-16`), no visible dividers — the dark background provides natural separation

---

## 6. Depth & Elevation

On dark surfaces, elevation is communicated primarily through **background luminance stepping** — each level slightly increases surface brightness.

| Level        | Treatment     | Tokens / Classes                             | Use                                    |
| ------------ | ------------- | -------------------------------------------- | -------------------------------------- |
| 0 — Canvas   | Deepest layer | `bg-background` (`#0a0a0c`)                  | Page background, sidebar               |
| 1 — Surface  | One step up   | `bg-canvas-background` (`#0f0f12`)           | Flow editor canvas                     |
| 2 — Card     | Elevated      | `bg-card` (`#141418`) + `border-border`      | Cards, panels, inputs                  |
| 3 — Popover  | Floating      | `bg-popover` (`#191a1f`) + `shadow-floating` | Dropdowns, popovers, command palette   |
| 4 — Selected | Interactive   | `bg-accent` (`#1e1e2a`)                      | Hover states, active items             |
| Focus        | Ring          | `ring-ring/50 ring-[3px]`                    | Keyboard focus on interactive elements |

**Shadow philosophy**: Shadows exist mainly at the floating layer (level 3+). At lower levels, the background luminance difference and semi-transparent borders provide sufficient depth cues. The `--fl-shadow-floating` token uses a `0 0 0 1px rgba(255,255,255,0.05)` ring to reinforce the boundary between floating elements and the canvas.

---

## 7. Do's and Don'ts

### Do

- Use `fl-*` theme tokens exclusively — `bg-background`, `text-foreground`, `border-border`, etc.
- Default to dark mode as the primary design surface
- Use semi-transparent borders (`rgba(255,255,255,0.05–0.08)`) in dark mode, not solid dark colors
- Keep button backgrounds near-transparent: `bg-secondary`, `hover:bg-accent` — never opaque
- Reserve `bg-primary` / `text-primary` (indigo-violet) for primary CTAs and interactive accents only
- Use `text-foreground` (`#f0f1f3`) for primary text — not pure `#ffffff`
- Apply `tracking-tighter` on display-size text, normal tracking on body
- Use `font-medium` (500) as the default emphasis weight, `font-semibold` (600) for strong emphasis
- Communicate elevation through background luminance steps, not shadow intensity
- Use `font-mono` (Iosevka) for code, node config forms, and technical labels

### Don't

- Don't hardcode colors — always use token-backed Tailwind classes
- Don't use pure `#ffffff` as primary text — `text-foreground` resolves to a softer near-white
- Don't use solid colored backgrounds for ghost/outline buttons — transparency is the system
- Don't apply the brand indigo decoratively — it's reserved for interactive/CTA elements only
- Don't use positive letter-spacing on display text
- Don't use solid opaque borders on dark backgrounds — borders should be semi-transparent
- Don't use weight 700+ — max emphasis weight is 600 (`font-semibold`)
- Don't introduce warm colors into the UI chrome — the palette is cool gray with indigo-violet accent only
- Don't use heavy drop shadows for elevation on dark surfaces — use background luminance stepping
- Don't break out of the `.flowlib` CSS scope — all tokens are scoped to this container

---

## 8. Implementing Theme Changes

### Where to Edit

All token definitions live in [pkg/ui/src/app.css](../../pkg/ui/src/app.css), inside:

```
@layer utilities {
  .flowlib {
    /* Light mode tokens (base) */
    --fl-background: #fafafa;
    ...

    &.dark {
      /* Dark mode tokens (overrides) */
      --fl-background: #0a0a0c;
      ...
    }
  }
}
```

### Token Architecture

The system uses a two-layer variable chain:

1. **`--fl-*` variables**: The source of truth. Set per theme mode.
2. **`--*` variables** (unprefixed): Aliases that point to `--fl-*`. Used by Tailwind's `@theme inline` block.
3. **Tailwind `--color-*` mappings**: Auto-generated from the `@theme inline` declaration.

```
--fl-primary: #7170ff
    ↓
--primary: var(--fl-primary)
    ↓
--color-primary: var(--primary)     ← Tailwind reads this
    ↓
bg-primary, text-primary, etc.     ← Component classes
```

To change a token value, edit the `--fl-*` variable. Everything downstream updates automatically.

### Adding New Tokens

1. Add `--fl-<name>` in the `.flowlib` scope (light value) and `.flowlib.dark` scope (dark value)
2. Add `--<name>: var(--fl-<name>)` alias
3. Add `--color-<name>: var(--<name>)` in the `@theme inline` block
4. Use via Tailwind: `bg-<name>`, `text-<name>`, etc.

### Component Variant Updates

Components use CVA variants in `pkg/ui/src/components/ui/`. To adjust a component's visual treatment:

1. Find the component file (e.g., `button.tsx`, `card.tsx`)
2. Edit the CVA variant classes — these are Tailwind classes referencing tokens
3. Changes take effect across the entire app immediately

---

## 9. Quick Reference — Agent Prompt Guide

### Dark Theme Token Cheat Sheet

```
Page bg:           bg-background         (#0a0a0c)
Canvas bg:         --canvas-background   (#0f0f12)
Card bg:           bg-card               (#141418)
Popover bg:        bg-popover            (#191a1f)
Heading text:      text-foreground       (#f0f1f3)
Body text:         text-foreground       (#f0f1f3)
Muted text:        text-muted-foreground (#8a8f98)
Primary accent:    bg-primary            (#7170ff)
CTA text:          text-primary-foreground (#ffffff)
Default border:    border-border         (rgba(255,255,255,0.08))
Subtle border:     border-sidebar-border (rgba(255,255,255,0.06))
Focus ring:        ring-ring             (#7170ff)
Success:           text-success          (#3dd68c)
Destructive:       bg-destructive        (#e5484d)
```

### Example Component Composition

```tsx
{
  /* Card on dark background */
}
<div className="bg-card border border-border rounded-xl p-6 shadow-[var(--fl-shadow-card)]">
  <h3 className="text-xl font-semibold text-foreground tracking-tight">Feature Title</h3>
  <p className="mt-2 text-sm text-muted-foreground">Description text in muted gray.</p>
  <div className="mt-4 flex gap-3">
    <Button variant="default">Primary CTA</Button>
    <Button variant="outline">Secondary</Button>
  </div>
</div>;
```

```tsx
{
  /* Navigation bar */
}
<nav className="bg-sidebar border-b border-sidebar-border px-4 py-3 flex items-center justify-between">
  <span className="text-sm font-medium text-sidebar-foreground">Flowlib</span>
  <div className="flex gap-4">
    <a className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
      Flows
    </a>
    <Button variant="default" size="sm">
      New Flow
    </Button>
  </div>
</nav>;
```

```tsx
{
  /* Badge / pill */
}
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-border text-muted-foreground">
  v2.1.0
</span>;
```

```tsx
{
  /* Command palette / popover */
}
<div className="bg-popover border border-border rounded-xl shadow-[var(--fl-shadow-floating)] p-2">
  <input
    className="w-full bg-transparent text-foreground placeholder:text-muted-foreground text-sm px-3 py-2 border-b border-border outline-none"
    placeholder="Search..."
  />
  <div className="mt-1 space-y-0.5">
    <div className="px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground rounded-md cursor-pointer">
      Create new flow
    </div>
  </div>
</div>;
```
