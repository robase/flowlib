# UI Visual Audit Tool

> Automated UX/design review: Playwright captures screenshots of every major UI state, then an AI vision model analyzes them and produces a structured report.

## Overview

A developer tool that lives in `playwright/visual-audit/`. It runs in two stages:

1. **Capture** — A Playwright script navigates the running app, exercises all major screens and UI states, and saves annotated screenshots.
2. **Analyze** — A Node.js script sends each screenshot (with context) to an AI vision model (Anthropic Claude or OpenAI GPT-4o) and compiles the findings into a Markdown report.

Run everything with a single command:

```bash
pnpm ux:audit
```

Or run each stage independently:

```bash
pnpm ux:capture   # just take screenshots
pnpm ux:analyze   # just run AI analysis on existing screenshots
```

---

## File Structure

```
playwright/
├── visual-audit/
│   ├── capture.ts          # Playwright script — navigates & takes screenshots
│   ├── analyze.ts          # Sends screenshots to AI, generates report
│   ├── screens.ts          # Screen definitions — what to capture & how
│   ├── VISUAL-AUDIT-PLAN.md  # This file
│   └── output/             # Generated artifacts (gitignored)
│       ├── screenshots/    # PNGs: 01-dashboard-collapsed.png, etc.
│       ├── metadata.json   # Per-screenshot context for the AI
│       └── REPORT.md       # Final analysis report
```

---

## Design Decisions

### Standalone tool, not part of the test suite

The audit is not a regression test — it doesn't assert pass/fail. It's slow (screenshots + API calls), needs realistic seeded data, and should be run on-demand. It gets its own Playwright project entry so `pnpm test:pw` never triggers it accidentally.

### Reuses the existing isolated-server fixture pattern

The `critical-paths/fixtures.ts` pattern already handles per-worker isolated SQLite databases, Express server spawning, and route interception. The capture script uses the same approach:

- Fresh SQLite database seeded with realistic flows (multi-node JQ pipeline, agent flow with tools, simple template flow)
- Isolated Express server on a random port
- Vite frontend at `localhost:5173` with API calls intercepted to the isolated server

No new infrastructure needed.

### Anthropic Claude as the primary analysis model

The project already uses `ANTHROPIC_API_KEY` for E2E agent tests, so no new credentials are needed. Claude's vision capabilities handle UI screenshots well. Falls back to `OPENAI_API_KEY` (GPT-4o) if no Anthropic key is set.

The analysis is **programmatic and batched** — all screenshots go through in a single run and produce one report, rather than manual Copilot chat sessions. The generated report can still be opened in Copilot chat for follow-up discussion or fed into a PR comment.

### Two-stage pipeline (capture → analyze)

Separating capture from analysis means you can:

- Re-run analysis with a different prompt without re-capturing
- Share screenshots with others who don't have API keys
- Iterate on the analysis prompt quickly
- Run capture in CI and analysis locally (future)

---

## Phase 1 — Screenshot Capture (`capture.ts`)

### Seed Data

Before capturing, the script seeds the isolated database with:

| Flow                | Nodes                                    | Purpose                      |
| ------------------- | ---------------------------------------- | ---------------------------- |
| **Data Pipeline**   | Input → JQ → Output (3 nodes)            | Standard flow, config panels |
| **AI Assistant**    | Input → Model → Agent → Output (4 nodes) | Agent node, tool selector    |
| **Simple Template** | Input → Template String (2 nodes)        | Minimal flow                 |

### UI States Captured

Each state gets a **full viewport** screenshot (1280×720). Modals and panels also get a **focused crop** via `locator.screenshot()` for higher-detail analysis.

#### Pages & Navigation

| #   | State                         | Actions                   | Tags                              |
| --- | ----------------------------- | ------------------------- | --------------------------------- |
| 01  | Dashboard — sidebar collapsed | Navigate to `/flowlib`    | `page`, `dashboard`, `navigation` |
| 02  | Dashboard — sidebar expanded  | Click sidebar toggle      | `page`, `dashboard`, `navigation` |
| 03  | Executions page               | Navigate via sidebar link | `page`, `executions`              |
| 04  | Credentials page              | Navigate via sidebar link | `page`, `credentials`             |

#### Modals & Overlays

| #   | State                | Actions                           | Tags                                  |
| --- | -------------------- | --------------------------------- | ------------------------------------- |
| 05  | Add Flow modal       | Click "+ New Flow" on dashboard   | `modal`, `dashboard`, `flow-creation` |
| 06  | Add Credential modal | Click "+ Add" on credentials page | `modal`, `credentials`                |

#### Flow Editor

| #   | State                              | Actions                      | Tags                                   |
| --- | ---------------------------------- | ---------------------------- | -------------------------------------- |
| 07  | Editor canvas — Data Pipeline flow | Navigate to seeded flow      | `editor`, `canvas`, `nodes`            |
| 08  | Node selected                      | Click on JQ node             | `editor`, `node-selection`             |
| 09  | Input node config panel            | Double-click Input node      | `editor`, `config-panel`, `input-node` |
| 10  | JQ node config panel               | Double-click JQ node         | `editor`, `config-panel`, `jq-node`    |
| 11  | Agent node config panel            | Double-click Agent node      | `editor`, `config-panel`, `agent-node` |
| 12  | Tool selector modal                | Open from agent config panel | `editor`, `modal`, `agent-tools`       |
| 13  | Editor toolbar / header            | (same view, crop the header) | `editor`, `toolbar`                    |

#### Theme

| #   | State                     | Actions                | Tags                     |
| --- | ------------------------- | ---------------------- | ------------------------ |
| 14  | Dashboard — dark mode     | Toggle theme           | `dark-mode`, `dashboard` |
| 15  | Editor canvas — dark mode | Toggle theme on editor | `dark-mode`, `editor`    |

This audit is intentionally desktop-only. Capture targets should reflect the primary product surface: the full desktop workflow editor and supporting admin screens.

### Metadata Output

`output/metadata.json` — array of entries, one per screenshot:

```json
[
  {
    "id": "01-dashboard-collapsed",
    "filename": "01-dashboard-collapsed.png",
    "description": "Dashboard page with sidebar in default collapsed (icon-only) state. Shows flow cards, stats section, and navigation icons.",
    "url": "/flowlib",
    "tags": ["page", "dashboard", "navigation"],
    "viewport": { "width": 1280, "height": 720 },
    "focusCrop": null
  },
  {
    "id": "09-input-config-panel",
    "filename": "09-input-config-panel.png",
    "focusCrop": "09-input-config-panel-focus.png",
    "description": "Node configuration panel for an Input node, opened via double-click. Shows parameter fields, input/output preview panels.",
    "url": "/flowlib/flow/<flowId>",
    "tags": ["editor", "config-panel", "input-node"],
    "viewport": { "width": 1280, "height": 720 }
  }
]
```

---

## Phase 2 — AI Analysis (`analyze.ts`)

### Model Selection

1. If `ANTHROPIC_API_KEY` is set → use **Claude Sonnet** (`claude-sonnet-4-20250514`) via the Anthropic SDK. Sonnet is the sweet spot: strong vision capabilities at reasonable cost/speed for batch analysis.
2. If only `OPENAI_API_KEY` → use **GPT-4o** via the OpenAI SDK.
3. If neither → exit with a message pointing to the env vars.

No new dependencies — both SDKs are already in the project's dependency tree via `@flowlib/core`.

### Analysis Strategy

Rather than analyzing each screenshot individually (expensive, slow, repetitive), the script uses a **two-pass approach**:

**Pass 1 — Per-screen analysis** (parallel, 4 at a time):
Each screenshot is sent individually with its metadata. The prompt asks for focused, structured findings.

**Pass 2 — Cross-screen synthesis** (single call):
All per-screen findings are sent together (text only, no images) asking the model to identify patterns, rank issues by impact, and produce the summary.

### Per-Screen Prompt

```
You are a senior UX/UI designer auditing "Flowlib" — a workflow orchestration
tool with a visual flow editor for building AI pipelines.

Analyze this screenshot of: {description}
Page URL: {url}
Context tags: {tags}

Evaluate and provide findings in these categories:

1. **Accessibility** — Contrast ratios, touch/click target sizes, screen reader
   hints, keyboard navigation affordances, WCAG compliance concerns.

2. **Visual Hierarchy & Layout** — Information density, visual weight distribution,
   whitespace usage, alignment, content grouping, scan-path flow.

3. **Consistency** — Spacing rhythm, typography scale, component reuse, icon style
   coherence, color palette usage.

4. **UX & Interaction** — Affordance clarity (do clickable things look clickable?),
   state feedback, error prevention, cognitive load, discoverability.

5. **Specific Suggestions** — 2-3 concrete, actionable changes with rationale.

Be direct. Only flag real issues, not style preferences. If something looks good,
say so briefly and move on.
```

### Synthesis Prompt

```
You've reviewed {N} screens of the Flowlib workflow editor. Below are your
per-screen findings.

{all findings joined}

Now synthesize:

1. **Recurring patterns** — Issues that appear across multiple screens.
2. **Top 10 priority changes** — Ranked by user impact. For each: the issue,
   which screens it affects, and a concrete fix.
3. **Strengths** — What the UI does well (2-3 points).
4. **Overall UX score** — Rate 1-10 with brief justification.
```

---

## Report Output

`analyze.ts` directly generates `output/REPORT.md` (no separate reporter script — keeping it simple).

### Report Structure

```markdown
# Flowlib UI Visual Audit Report

> Generated: 2025-03-14T19:00:00Z | Model: claude-sonnet-4-20250514 | Screenshots: 18

## Summary

[Overall score, key strengths, top 3 issues]

## Priority Changes

[Ranked top 10 list from synthesis]

## Per-Screen Analysis

### 01 — Dashboard (sidebar collapsed)

![](screenshots/01-dashboard-collapsed.png)
[AI findings for this screen]

### 02 — Dashboard (sidebar expanded)

![](screenshots/02-dashboard-expanded.png)
[AI findings for this screen]

... (all 18 screens)

## Recurring Patterns

[Cross-screen synthesis]
```

The report renders inline in VS Code, GitHub, and any Markdown viewer. Screenshots use relative paths so the report works as long as the `output/` folder is intact.

---

## Integration Points

### npm Scripts (root `package.json`)

```json
{
  "ux:capture": "npx playwright test --config playwright/playwright.config.ts --project visual-audit",
  "ux:analyze": "npx tsx playwright/visual-audit/analyze.ts",
  "ux:audit": "pnpm ux:capture && pnpm ux:analyze"
}
```

### Playwright Config Addition

New project entry in `playwright/playwright.config.ts`:

```ts
{
  name: "visual-audit",
  testMatch: /visual-audit\/capture\.ts/,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:5173",
    screenshot: "off",       // we handle screenshots manually
    video: "off",
    trace: "off",
  },
}
```

### Gitignore Addition

```
playwright/visual-audit/output/
```

---

## Usage

### Prerequisites

- Dev servers running: `pnpm dev:fullstack` (or the shared webServers start automatically via Playwright config)
- One of: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set in environment (for analysis step only; capture works without)

### Quick Start

```bash
# Full audit: capture screenshots + analyze with AI
pnpm ux:audit

# Just capture (no API key needed)
pnpm ux:capture

# Re-analyze existing screenshots (e.g. after tweaking the prompt)
pnpm ux:analyze

# Open the generated report
open playwright/visual-audit/output/REPORT.md
```

### Using the Report with Copilot

After generating, you can reference the report in Copilot chat for follow-up:

```
@workspace Review the UX audit report in playwright/visual-audit/output/REPORT.md
and suggest code changes to address the top 3 priority items.
```

---

## Implementation Checklist

- [ ] Add `visual-audit` project to `playwright/playwright.config.ts`
- [ ] Create `playwright/visual-audit/screens.ts` — screen definitions (what to capture)
- [ ] Create `playwright/visual-audit/capture.ts` — Playwright capture script
- [ ] Create `playwright/visual-audit/analyze.ts` — AI analysis + report generation
- [ ] Add `ux:capture`, `ux:analyze`, `ux:audit` scripts to root `package.json`
- [ ] Add `playwright/visual-audit/output/` to `.gitignore`

## Future Extensions (out of scope for now)

- **Visual regression** — Diff screenshots between runs to catch unintended changes
- **CI integration** — Run capture in CI, post report as a PR comment
- **Desktop viewport matrix** — Systematic coverage of laptop/desktop/ultrawide breakpoints
- **Component-level audit** — Capture individual UI components in isolation (Storybook-style)
- **Lighthouse integration** — Pair visual audit with performance/accessibility metrics
