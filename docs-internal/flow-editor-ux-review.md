# Flow Editor UX Review — Node Editing & Testing

**Scope:** The day-to-day loop of a power user editing flows — opening nodes, editing their config forms, testing/running, and moving on. Focused on the node config panel, the per-node-type form generation, the agent node, and the canvas interactions that surround editing.

**Date:** 2026-06-09

---

## TL;DR — the editing loop today

The current loop for one node is roughly:

> double-click node → 90vh modal opens → edit a field (autosaves) → manually retype `{{ upstream.x }}` references → click **Run Node** → read the right-hand Output pane → if error, reconcile the summary in the middle pane with the full error on the right → click **Close** → double-click the next node → repeat

The foundations are genuinely good: a clean three-pane Input / Config / Output layout, autosave, dynamic forms driven by `params.fields`, template syntax highlighting, rich copy/paste, and a real keyboard-shortcut layer. But the _inner loop_ — the thing a power user does hundreds of times a day — has accumulated friction that compounds:

1. **No template autocomplete** — the single biggest daily tax. Users hand-type `{{ ... }}` references with no completion, while the input data sits right there in the left pane.
2. **The config panel is a giant modal** — you can't see the canvas or adjacent nodes while editing, and every node is a full open/close cycle.
3. **No undo/redo anywhere in the editor** — destructive and irreversible; terrifying for someone iterating fast.
4. **Field descriptions are silently dropped** in the main config form, so non-obvious params have zero inline help.
5. **Test inputs evaporate** — the feedback loop has no memory; nothing persists across panel close or refresh.

The rest of this doc breaks these down and proposes concrete, prioritized changes.

---

## 1. Template editing is the hottest path and the weakest

Almost every node param of consequence is a template field (`text`, `textarea`, `json`, `code` are _always_ in template mode). This is where users spend most of their time, and it's underpowered.

### Findings

- **No `{{ }}` autocomplete in the Nunjucks editor.** `CodeMirrorNunjucksEditor` highlights syntax but offers no completion. To reference upstream data, users either drag from the input tree or hand-type the full path (e.g. `{{ fetch_user.data.variables.output.value }}`) from memory. The code editor (`CodeMirrorJsEditor`) _does_ have one-level autocomplete — so the experience is inconsistent across field types.
- **The data you need is one pane away but disconnected.** The left Input pane shows the exact JSON available to the node, but there's no bridge from "I can see `fetch_user.id` in the Input pane" to "put it in this field."
- **No template validation until execution.** A typo'd Nunjucks expression or a reference to a non-existent upstream key fails only at run time, with a generic error.
- **`field.description` is not rendered in the main form.** `ConfigFieldWithTemplate` only uses `description` for _select option_ subtitles (`ConfigFieldWithTemplate.tsx:278`) — the field-level `description` from `defineAction` is dropped. Meanwhile `ToolParamField` (agent tools) _does_ render descriptions as info tooltips. So the same metadata shows up in tool config but vanishes in node config.
- **No `required` affordance.** Required fields aren't marked (`*`, bold, anything). Required-ness only surfaces as a Zod error after a failed run.

### Recommendations (highest leverage first)

1. **Add `{{ }}` autocomplete to the Nunjucks editor, sourced from the live Input pane data.** Typing `{{` (or `.` after a token) should pop a completion list of available upstream keys and nested paths, with type hints from the actual input JSON. This single change removes the most repeated friction in the product.
2. **Make the Input pane click-to-insert.** Clicking a leaf in the input JSON tree inserts `{{ path }}` at the cursor of the focused field. (Drag already exists conceptually; clicking is faster and more discoverable.)
3. **Render `field.description` inline** as muted helper text under the label (or an info tooltip, matching `ToolParamField`). Zero new data needed — the descriptions already exist in action definitions.
4. **Mark required fields** with a `*` and surface unfilled-required state _before_ run (cheap client-side check against the schema).
5. **Lint templates inline** — flag references to keys not present in the current Input data with a subtle squiggle, so users catch `{{ fetchuser.id }}` → `{{ fetch_user.id }}` before running.

---

## 2. The config panel is a modal — make editing feel inline

### Findings

- `NodeConfigPanel` is a `Dialog` at `h-[90vh]`, `top-[5vh]`. While open, **the canvas and all other nodes are hidden.** You lose all spatial context — which node feeds this one, what's downstream — at exactly the moment you need it.
- **Every node is a full open→edit→close cycle.** Editing a chain of 6 nodes means 6 modal open/closes. There's no "next node" affordance inside the panel.
- **Close button is a non-standard text button at `bottom-4 right-4`**, not the conventional top-right `X`. Minor, but it trips muscle memory.
- The panel **does not remember UI state** (scroll position, which "More Options" sections were expanded) across close/reopen.

### Recommendations

1. **Move to a docked side panel, not a centered modal.** Anchor it to one side so the canvas (and the node being edited, with its neighbors) stays visible. This is the structural change that makes the whole loop feel "in the trenches" friendly. ReactFlow stays interactive; selecting a different node swaps the panel content.
2. **Add prev/next node navigation inside the panel** (e.g. `Ctrl+↑/↓` or buttons that walk topological order), so editing a chain doesn't require returning to the canvas between every node.
3. **Persist panel UI state per node** (expanded sections, active tab, scroll) for the session.
4. **Standardize the close affordance** — top-right `X` plus `Esc` (Esc already closes; make it discoverable).

---

## 3. No undo/redo — the scariest gap

### Findings

- **There is no undo/redo in the flow editor.** Confirmed: no history stack for canvas operations. Delete/Backspace removes selected nodes immediately and permanently; autosave writes param changes to the store with no rollback.
- Combined with **autosave + no dirty indicator**, a user has no safety net: mistype a code field, delete the wrong node, or paste over something, and there's no `Cmd+Z`.

### Recommendations

1. **Implement `Cmd+Z` / `Cmd+Shift+Z` with a bounded history stack** covering node add/delete/move, edge add/delete, and param edits. This is table-stakes for an editor people use all day and is likely the highest-trust-building change on this list.
2. Until then, at minimum **confirm destructive deletes of connected nodes** (a node with edges) and **show a toast with "Undo"** after delete/paste.

---

## 4. The test/feedback loop has no memory

Testing is well-built mechanically (Run Node, test mode with a `TEST` badge, per-field error parsing) but the loop is stateless and lossy.

### Findings

- **Test inputs don't persist.** Type custom JSON in the Input pane, run, close the panel → on reopen the custom input is **gone**, reverted to computed input. There's no concept of saved test cases or scenarios.
- **Preview state dies on refresh.** `previewInput` / `previewOutput` live in node data for the session but aren't persisted; a page reload wipes all last-run results.
- **Errors are shown in two places at once** — a truncated summary in the middle Config pane (`ExecutionErrorDisplay`, with "See full error in Output panel ↓") and the full error in the right Output pane. Users bounce between them.
- **No keyboard shortcut to run a node.** Every test is a mouse trip to the header button. (Flow-level run has `Cmd+Enter`; single-node run has nothing.)
- **No re-run / compare.** No "run again" distinct from "run with new params," and no diff between the last two outputs — so verifying that a tweak changed the output means eyeballing JSON twice.
- **Batch nodes dead-end the loop** — execution pauses with "Check the Runs view for status" and no inline polling; the user has to leave the editor.

### Recommendations

1. **`Cmd+Enter` to run the focused node** from anywhere in the panel. Cheapest win in this section.
2. **Persist test inputs as named scenarios per node (or per flow).** Let a user save "happy path", "empty list", "malformed payload" and one-click replay them. This is what turns ad-hoc testing into a real inner loop.
3. **Persist last-run preview** across refresh so reopening a flow shows the last known input/output.
4. **Unify error display** — one place, expandable. Drop the duplicate summary, or make the summary the collapsed state of the full error.
5. **Output diff toggle** — when a node is re-run, offer "diff vs previous run" so changes are obvious.

---

## 5. The Agent node is powerful but opaque

### Findings

- Agent config spans several surfaces: `AgentConfigPanel` (near-fullscreen modal), `ToolSelectorModal` (3-pane browse/added/details), `ToolConfigPanel` (slide-in), `AgentToolsBox` (canvas card, max 6 tools + "+N more"), and the in-panel Tools tab. It's a lot of nested modals.
- **The "AI Chosen" vs "Static" per-param toggle has no preview of what the agent actually receives.** A user toggles a param to AI-provided but never sees the effective tool schema sent to the LLM (it's buried in a collapsible "Effective Schema").
- **No validation across tools** — multiple tools with conflicting param names aren't flagged.
- Credential modals can open _inside_ the tool selector modal → modal-on-modal nesting.

### Recommendations

1. **Show a live "what the agent sees" preview** — the effective tool schema (after AI-chosen/static filtering) rendered plainly, updating as toggles change. This is the agent equivalent of the Input pane.
2. **Flatten the modal stack** — prefer the docked side panel pattern (see §2) over modal-in-modal for tool config.
3. **Surface the most-used controls** (model, system prompt, enabled tools) without entering the big modal — e.g. inline on the canvas card or the first panel screen.

---

## 6. Canvas interactions around editing

The canvas is keyboard-strong (copy/paste with SDK-text fallback, cut, duplicate, multi-select, command palette, auto-layout). The gaps are about _getting into_ editing and small repetitive actions.

### Findings

- **Double-click required to open config; single-click only selects.** Deliberate, but it's an extra action on the most common operation.
- **No right-click context menu.** Rename, delete, duplicate, "run from here" all require remembering keyboard shortcuts. New/occasional flows suffer; even power users lose quick discoverability.
- **No "add node on edge" affordance** — no `+` between connected nodes. Inserting a node mid-chain means add-from-sidebar then manually rewire two edges. Confirmed no edge-insert handler exists.
- **Edges aren't directly clickable** (only drag-selectable), so deleting/replacing a single edge is awkward.
- Auto-layout is a nice touch (elk/dagre/d3-force, respects selection centroid).

### Recommendations

1. **Add a `+` affordance on edges** to insert a node mid-chain with automatic rewiring. Huge for iterative flow-building.
2. **Add a right-click context menu** on nodes (Open, Run from here, Duplicate, Delete, Copy) and edges (Insert node, Delete). Mirrors the keyboard shortcuts for discoverability.
3. Consider **single-click-to-open** in the docked-panel world (§2) — once the panel doesn't obscure the canvas, opening on select is cheap and the double-click friction disappears.
4. **Make edges selectable/deletable** with a click.

---

## Prioritized roadmap

Ranked by (impact on the daily loop) × (relative effort).

### Tier 1 — do these first (highest impact, contained scope)

| #   | Change                                               | Why it matters                                             |
| --- | ---------------------------------------------------- | ---------------------------------------------------------- |
| 1   | **`{{ }}` autocomplete from live Input data** (§1.1) | Removes the single most-repeated friction in the product   |
| 2   | **Click-to-insert from the Input pane** (§1.2)       | Bridges "I can see the data" → "use the data"              |
| 3   | **Render `field.description` inline** (§1.3)         | Free — data already exists; eliminates guesswork on params |
| 4   | **`Cmd+Enter` to run focused node** (§4.1)           | Cuts a mouse trip out of every single test                 |
| 5   | **Undo/redo** (§3.1)                                 | Trust + safety net; table-stakes for all-day use           |

### Tier 2 — structural wins

| #   | Change                                            | Why it matters                                   |
| --- | ------------------------------------------------- | ------------------------------------------------ |
| 6   | **Docked side panel instead of modal** (§2.1)     | Keeps canvas context; makes editing feel inline  |
| 7   | **Prev/next node navigation in panel** (§2.2)     | Editing a chain stops being N modal cycles       |
| 8   | **Persist test inputs as named scenarios** (§4.2) | Turns ad-hoc testing into a real repeatable loop |
| 9   | **Add-node-on-edge `+` affordance** (§6.1)        | Iterative flow construction                      |
| 10  | **Unify error display** (§4.4)                    | Stops the bounce between two panes               |

### Tier 3 — polish & depth

- Required-field markers + pre-run validation (§1.4)
- Inline template linting (§1.5)
- Right-click context menus (§6.2)
- Persist last-run preview across refresh (§4.3)
- Output diff on re-run (§4.5)
- Agent "what the agent sees" schema preview (§5.1)
- Standardize close affordance, persist panel UI state (§2.3–2.4)

---

## What's already good (keep it)

- Clean three-pane Input / Config / Output mental model.
- Autosave — no Save/Discard bookkeeping.
- Dynamic forms from `params.fields` with sensible field-type coverage and "More Options" grouping for `extended` fields.
- Inline-editable node name.
- Template + Static toggle for non-template field types, persisted in `_templateModes`.
- Dynamic/API-backed selects with dependency tracking and stale-value handling (`DynamicSelectField`).
- Rich copy/paste (SDK-text fallback, cross-flow paste strips credentials), multi-select, duplicate, command palette (`Cmd+K`), and auto-layout.
- Clear per-node execution status on the canvas (running/pending/success/failed/skipped borders).

---

## Key files (for whoever implements this)

- Panel shell: `pkg/ui/src/components/flow-editor/node-config-panel/NodeConfigPanel.tsx`
- Config pane + Run button: `.../node-config-panel/panels/ConfigurationPanel.tsx`
- Input / Output panes: `.../panels/InputPanel.tsx`, `.../panels/OutputPanel.tsx`
- Field rendering: `.../node-config-panel/ConfigFieldWithTemplate.tsx`, `.../ParametersSection.tsx`, `.../DynamicSelectField.tsx`, `.../SearchableSelectField.tsx`, `.../SwitchCasesField.tsx`
- Template editors: `pkg/ui/src/components/ui/codemirror-nunjucks-editor.tsx`, `.../codemirror-js-editor.tsx`
- Execution loop: `.../node-config-panel/hooks/use-node-execution.ts`, `.../hooks/use-node-config-panel-state.ts`
- Agent: `pkg/ui/src/components/nodes/AgentConfigPanel.tsx`, `ToolSelectorModal.tsx`, `ToolParamField.tsx`, `pkg/ui/src/components/flow-editor/ToolConfigPanel.tsx`
- Canvas: `pkg/ui/src/components/flow-editor/FlowWorkbenchView.tsx`, `use-copy-paste.ts`, `keyboard-shortcuts.ts`, `pkg/ui/src/components/nodes/UniversalNode.tsx`, `AgentNode.tsx`
