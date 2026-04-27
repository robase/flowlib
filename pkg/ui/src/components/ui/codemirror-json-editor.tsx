import { forwardRef, useEffect, useImperativeHandle, useRef, useCallback, useState } from 'react';
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightSpecialChars,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  gutter,
  GutterMarker,
} from '@codemirror/view';
import {
  EditorState,
  Extension,
  RangeSetBuilder,
  RangeSet,
  StateField,
  StateEffect,
} from '@codemirror/state';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  foldEffect,
  foldable,
  unfoldAll,
} from '@codemirror/language';
import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { linter, lintKeymap } from '@codemirror/lint';
import { cn } from '../../lib/utils';
import {
  CODEMIRROR_IOSEVKA_FONT_STACK,
  useCodeMirrorVscodePalette,
  useCodeMirrorVscodeTheme,
  type CodeMirrorVscodePalette,
} from './codemirror-vscode-theme';
import type { UpstreamSlot } from '../flow-editor/node-config-panel/types';
import { getIconComponent, formatNodeTypeLabel } from '../flow-editor/node-config-panel/utils';
import { createPortal } from 'react-dom';
import { useFlowlibPortalClass } from '../../hooks/use-flowlib-portal-class';

interface CodeMirrorJsonEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: string;
  /** Disable JSON syntax error highlighting (useful for output panels showing plain text) */
  disableLinting?: boolean;
  /** Upstream slot metadata for inline run controls */
  upstreamSlots?: UpstreamSlot[];
  /** Called when user clicks the run/retry button for a slot */
  onRunSlot?: (slot: UpstreamSlot) => void;
  /** JSON keys to auto-fold when content is set (e.g. ['previous_nodes']) */
  defaultFoldKeys?: string[];
  /**
   * When true, automatically fold any object/array nested at depth ≥ 3 that
   * contains more than one immediate child. Reduces noise in deeply nested
   * payloads (e.g. node-execution outputs with embedded `previous_nodes`).
   * The user can expand individual sections via the fold gutter, or all at
   * once via the imperative `expandAll()` handle.
   */
  autoFoldDeep?: boolean;
}

/** Imperative handle exposed via `ref` for parent components. */
export interface CodeMirrorJsonEditorHandle {
  /** Unfold every currently-folded region in the editor. */
  expandAll: () => void;
}

// Theme extension for styling
function createEditorTheme(palette: CodeMirrorVscodePalette) {
  return EditorView.theme({
    '&': {
      fontSize: '11px',
      fontFamily: CODEMIRROR_IOSEVKA_FONT_STACK,
      '--cm-vscode-widget-surface': palette.surface,
      '--cm-vscode-widget-surface-alt': palette.surfaceAlt,
      '--cm-vscode-widget-border': palette.border,
      '--cm-vscode-widget-fg': palette.foreground,
      '--cm-vscode-widget-fg-muted': palette.foregroundMuted,
      '--cm-vscode-widget-fg-inverse': palette.foregroundInverse,
      '--cm-vscode-widget-accent': palette.accent,
      '--cm-vscode-widget-accent-hover': palette.accentHover,
      '--cm-vscode-widget-selection': palette.selection,
    },
    '.cm-scroller, .cm-content, .cm-gutters, .cm-lineNumbers, .cm-tooltip': {
      fontFamily: CODEMIRROR_IOSEVKA_FONT_STACK,
    },
    '.cm-content': {
      padding: '8px 0',
    },
    '.cm-line': {
      padding: '0 8px',
    },
    '.cm-gutters': {
      paddingRight: '4px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 4px',
      minWidth: '32px',
      fontSize: '10px',
    },
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    '.cm-tooltip': {
      backgroundColor: palette.surface,
      border: `1px solid ${palette.border}`,
      color: palette.foreground,
      boxShadow: `0 6px 18px color-mix(in srgb, ${palette.border} 35%, transparent)`,
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: palette.selection,
      color: palette.foreground,
    },
    '.cm-panels': {
      backgroundColor: palette.surface,
      color: palette.foreground,
      borderColor: palette.border,
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: `1px solid ${palette.border}`,
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: `1px solid ${palette.border}`,
    },
    '.cm-panel button': {
      backgroundColor: palette.surfaceAlt,
      color: palette.foreground,
      border: `1px solid ${palette.border}`,
    },
    '.cm-panel button:hover': {
      backgroundColor: palette.surface,
      borderColor: palette.accent,
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: `underline wavy ${palette.error}`,
      textDecorationSkipInk: 'none',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: `underline wavy ${palette.function}`,
      textDecorationSkipInk: 'none',
    },
    '.cm-lint-marker-error': {
      content: "'●'",
      color: palette.error,
    },
    '.cm-lint-marker-warning': {
      content: "'●'",
      color: palette.function,
    },
    '.cm-tooltip-lint': {
      padding: '4px 8px',
      fontSize: '12px',
    },
    '.cm-completionLabel': {
      fontSize: '12px',
    },
    '.cm-completionMatchedText': {
      fontWeight: '600',
      textDecoration: 'none',
    },
  });
}

// Read-only styling
const readOnlyTheme = EditorView.theme({
  '.cm-content': {
    cursor: 'default',
  },
});

// =====================================
// Upstream Slot Gutter System
// =====================================

// StateEffect to update upstream slots from React
const setUpstreamSlots = StateEffect.define<UpstreamSlot[]>();

// Module-level callback ref (set from React, read by gutter click handler)
let slotCallbackRef: ((slot: UpstreamSlot) => void) | null = null;

// Module-level hover callbacks (set from React, called by gutter marker DOM events)
interface SlotHoverInfo {
  slot: UpstreamSlot;
  rect: DOMRect;
}
let slotHoverEnterRef: ((info: SlotHoverInfo) => void) | null = null;
let slotHoverLeaveRef: (() => void) | null = null;

// StateField that holds the current upstream slots
const upstreamSlotsField = StateField.define<UpstreamSlot[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setUpstreamSlots)) {
        return effect.value;
      }
    }
    return value;
  },
});

/**
 * Find the top-level JSON key on a given document line.
 * Returns null if the line does not start a top-level property (e.g. nested lines, braces).
 */
function findTopLevelKeyOnLine(lineText: string): string | null {
  // Match lines like:  "some_key": ...  (with optional leading whitespace)
  const m = lineText.match(/^\s*"([^"]+)"\s*:/);
  return m ? m[1] : null;
}

// Play icon SVG (idle / resolved)
const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
// Spinner SVG (loading)
const SPINNER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;
// Warning SVG (error)
const WARNING_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

class SlotGutterMarker extends GutterMarker {
  constructor(readonly slot: UpstreamSlot) {
    super();
  }

  eq(other: SlotGutterMarker): boolean {
    return (
      this.slot.sourceNodeId === other.slot.sourceNodeId && this.slot.status === other.slot.status
    );
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div');

    let svg: string;
    let className: string;

    switch (this.slot.status) {
      case 'loading':
        svg = SPINNER_SVG;
        className = 'cm-slot-loading';
        break;
      case 'error':
        svg = WARNING_SVG;
        className = 'cm-slot-error';
        break;
      case 'resolved':
        svg = PLAY_SVG;
        className = 'cm-slot-resolved';
        break;
      default: // idle
        svg = PLAY_SVG;
        className = 'cm-slot-idle';
        break;
    }

    wrapper.className = `cm-slot-marker ${className}`;
    wrapper.innerHTML = svg;

    // Hover handlers — drive the React popover
    const slot = this.slot;
    wrapper.addEventListener('mouseenter', () => {
      if (slotHoverEnterRef) {
        slotHoverEnterRef({ slot, rect: wrapper.getBoundingClientRect() });
      }
    });
    wrapper.addEventListener('mouseleave', () => {
      if (slotHoverLeaveRef) {
        slotHoverLeaveRef();
      }
    });

    return wrapper;
  }
}

/**
 * Gutter that shows run controls for upstream slots.
 * Markers appear on lines that hold a top-level JSON key matching a slot key.
 */
const slotGutter = gutter({
  class: 'cm-slot-gutter',
  markers: (view) => {
    const slots = view.state.field(upstreamSlotsField);
    if (slots.length === 0) {
      return RangeSet.empty;
    }

    const slotsByKey = new Map(slots.map((s) => [s.key, s]));
    const builder = new RangeSetBuilder<GutterMarker>();

    for (let i = 1; i <= view.state.doc.lines; i++) {
      const line = view.state.doc.line(i);
      const key = findTopLevelKeyOnLine(line.text);
      if (key && slotsByKey.has(key)) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by has() check above
        builder.add(line.from, line.from, new SlotGutterMarker(slotsByKey.get(key)!));
      }
    }

    return builder.finish();
  },
  domEventHandlers: {
    click: (view, line) => {
      const slots = view.state.field(upstreamSlotsField);
      if (slots.length === 0) {
        return false;
      }

      const lineText = view.state.doc.lineAt(line.from).text;
      const key = findTopLevelKeyOnLine(lineText);
      if (!key) {
        return false;
      }

      const slot = slots.find((s) => s.key === key);
      if (!slot || slot.status === 'loading') {
        return false;
      }

      if (slotCallbackRef) {
        slotCallbackRef(slot);
      }
      return true;
    },
  },
});

/**
 * ViewPlugin that dims `null` values on lines matching unresolved or loading slots.
 */
const slotValueDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((t) => t.effects.some((e) => e.is(setUpstreamSlots)))
      ) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView): DecorationSet {
      const slots = view.state.field(upstreamSlotsField);
      if (slots.length === 0) {
        return Decoration.none;
      }

      const slotsByKey = new Map(slots.map((s) => [s.key, s]));
      const builder = new RangeSetBuilder<Decoration>();

      for (let i = 1; i <= view.state.doc.lines; i++) {
        const line = view.state.doc.line(i);
        const key = findTopLevelKeyOnLine(line.text);
        if (!key) {
          continue;
        }

        const slot = slotsByKey.get(key);
        if (!slot) {
          continue;
        }

        if (slot.status === 'idle') {
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-slot-idle-line' }));
        } else if (slot.status === 'loading') {
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-slot-loading-line' }));
        } else if (slot.status === 'error') {
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-slot-error-line' }));
        }
      }

      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// Slot gutter styles
const slotGutterStyles = `
  .cm-slot-gutter {
    width: 18px;
    min-width: 18px;
  }
  .cm-slot-gutter .cm-gutterElement {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 1px;
  }
  .cm-slot-marker {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    width: 14px;
    height: 14px;
  }
  .cm-slot-marker svg {
    width: 11px;
    height: 11px;
  }

  /* Idle — always visible, accent color */
  .cm-slot-idle svg {
    color: var(--cm-vscode-widget-accent);
    opacity: 1;
    transition: opacity 0.15s, filter 0.15s;
  }
  .cm-slot-idle:hover svg {
    filter: brightness(1.2);
  }

  /* Loading */
  .cm-slot-loading {
    cursor: default;
  }
  .cm-slot-loading svg {
    color: var(--cm-vscode-widget-accent);
    animation: cm-slot-spin 0.8s linear infinite;
  }
  @keyframes cm-slot-spin {
    to { transform: rotate(360deg); }
  }

  /* Resolved — always visible, subtle */
  .cm-slot-resolved svg {
    color: var(--cm-vscode-widget-accent);
    opacity: 0.35;
    transition: opacity 0.15s;
  }
  .cm-slot-resolved:hover svg {
    opacity: 1;
  }

  /* Error */
  .cm-slot-error svg {
    color: var(--cm-vscode-widget-error, #f85149);
  }
  .cm-slot-error:hover svg {
    filter: brightness(1.2);
  }

  /* Line decorations */
  .cm-slot-idle-line {
    opacity: 0.55;
  }
  .cm-slot-loading-line {
    opacity: 0.55;
    animation: cm-slot-shimmer 1.5s ease-in-out infinite;
  }
  @keyframes cm-slot-shimmer {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 0.65; }
  }
  .cm-slot-error-line {
    background: color-mix(in srgb, var(--cm-vscode-widget-error, #f85149) 6%, transparent);
  }
`;

let slotStylesInjected = false;
function injectSlotStyles() {
  if (slotStylesInjected) {
    return;
  }
  const style = document.createElement('style');
  style.setAttribute('data-codemirror-slots', 'true');
  style.textContent = slotGutterStyles;
  document.head.appendChild(style);
  slotStylesInjected = true;
}

/**
 * Programmatically fold JSON keys matching the given list.
 * Finds lines starting with `"key":` and folds the value region.
 */
function foldMatchingKeys(view: EditorView, keys: string[]) {
  const effects: Array<ReturnType<typeof foldEffect.of>> = [];
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i);
    const trimmed = line.text.trimStart();
    for (const key of keys) {
      if (trimmed.startsWith(`"${key}"`)) {
        const range = foldable(view.state, line.from, line.to);
        if (range) {
          effects.push(foldEffect.of(range));
        }
      }
    }
  }
  if (effects.length > 0) {
    view.dispatch({ effects });
  }
}

/**
 * Fold any object/array opener at depth ≥ `depthThreshold` whose body has
 * more than one immediate child. Designed to run against the output of
 * `JSON.stringify(value, null, indentSize)`, which produces predictable
 * `indentSize`-space indentation per nesting level.
 *
 * Depth is 1-indexed: the root `{`/`[` is depth 1, its direct children
 * (which sit at indent `indentSize`) open structures at depth 2, and so on.
 * "More than one child" is counted by lines whose indent is exactly the
 * opener's indent + `indentSize` (i.e. immediate children, not grandchildren).
 */
function foldDeepNested(
  view: EditorView,
  options: { indentSize?: number; depthThreshold?: number; minChildren?: number } = {},
) {
  const indentSize = options.indentSize ?? 2;
  const depthThreshold = options.depthThreshold ?? 3;
  const minChildren = options.minChildren ?? 2;

  const effects: Array<ReturnType<typeof foldEffect.of>> = [];
  const totalLines = view.state.doc.lines;

  for (let i = 1; i <= totalLines; i++) {
    const line = view.state.doc.line(i);
    const text = line.text;
    // The opener line ends with `{` or `[` — possibly followed by trailing
    // whitespace. Anything else (closers, scalar properties, blank lines)
    // is not a foldable opener.
    const trimmedRight = text.replace(/\s+$/, '');
    if (!trimmedRight.endsWith('{') && !trimmedRight.endsWith('[')) {
      continue;
    }
    const leadingMatch = text.match(/^( *)/);
    const leadingSpaces = leadingMatch ? leadingMatch[1].length : 0;
    if (leadingSpaces % indentSize !== 0) {
      continue;
    }
    const depth = leadingSpaces / indentSize + 1;
    if (depth < depthThreshold) {
      continue;
    }

    // Count immediate children: lines whose indent is exactly opener+indentSize.
    // Stop at the matching closer (a line at the opener's indent starting with
    // `}` or `]`).
    const childIndent = leadingSpaces + indentSize;
    let childCount = 0;
    for (let j = i + 1; j <= totalLines; j++) {
      const childLine = view.state.doc.line(j);
      const childText = childLine.text;
      const childLeadingMatch = childText.match(/^( *)/);
      const childLeading = childLeadingMatch ? childLeadingMatch[1].length : 0;
      if (childLeading === leadingSpaces) {
        const trimmed = childText.trimStart();
        if (trimmed.startsWith('}') || trimmed.startsWith(']')) {
          break;
        }
      }
      if (childLeading === childIndent) {
        childCount++;
        if (childCount >= minChildren) {
          break;
        }
      }
    }

    if (childCount < minChildren) {
      continue;
    }

    const range = foldable(view.state, line.from, line.to);
    if (range) {
      effects.push(foldEffect.of(range));
    }
  }

  if (effects.length > 0) {
    view.dispatch({ effects });
  }
}

export const CodeMirrorJsonEditor = forwardRef<
  CodeMirrorJsonEditorHandle,
  CodeMirrorJsonEditorProps
>(function CodeMirrorJsonEditor(
  {
    value,
    onChange,
    readOnly = false,
    className,
    minHeight = '200px',
    disableLinting = false,
    upstreamSlots,
    onRunSlot,
    defaultFoldKeys,
    autoFoldDeep = false,
  }: CodeMirrorJsonEditorProps,
  ref,
) {
  const vscodePalette = useCodeMirrorVscodePalette();
  const vscodeTheme = useCodeMirrorVscodeTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);

  const hasSlots = Boolean(upstreamSlots && upstreamSlots.length > 0);

  // Hover state for slot popover
  const [hoveredSlotInfo, setHoveredSlotInfo] = useState<SlotHoverInfo | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inject slot gutter styles and update callback refs
  useEffect(() => {
    if (hasSlots) {
      injectSlotStyles();
    }
    if (onRunSlot) {
      slotCallbackRef = onRunSlot;
    }

    slotHoverEnterRef = (info: SlotHoverInfo) => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setHoveredSlotInfo(info);
    };
    slotHoverLeaveRef = () => {
      // Small grace period so the popover doesn't flicker when moving between marker and popover
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredSlotInfo(null);
      }, 100);
    };

    return () => {
      if (slotCallbackRef === onRunSlot) {
        slotCallbackRef = null;
      }
      slotHoverEnterRef = null;
      slotHoverLeaveRef = null;
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, [onRunSlot, hasSlots]);

  // Keep refs up to date
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Update initial value ref for editor creation
  useEffect(() => {
    initialValueRef.current = value;
  }, [value]);

  // Create the editor
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const extensions: Extension[] = [
      foldGutter(),
      highlightSpecialChars(),
      history(),
      bracketMatching(),
      closeBrackets(), // Auto-close brackets, quotes, etc.
      autocompletion(), // Basic autocompletion
      EditorView.lineWrapping,
      highlightActiveLine(),
      json(),
      vscodeTheme,
      createEditorTheme(vscodePalette),
      EditorView.domEventHandlers({
        keydown: (event) => {
          event.stopPropagation();
          return false;
        },
        keyup: (event) => {
          event.stopPropagation();
          return false;
        },
      }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...(!disableLinting ? lintKeymap : []),
      ]),
    ];

    // Add JSON linting unless disabled (for output panels showing plain text)
    if (!disableLinting) {
      extensions.push(linter(jsonParseLinter()));
    }

    // Add upstream slot gutter if slots are provided
    if (hasSlots) {
      extensions.push(upstreamSlotsField, slotGutter, slotValueDecorations);
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true), readOnlyTheme);
    } else {
      // Add update listener for editable mode
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      );
    }

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Auto-fold specified keys and/or deep-nested structures after creation.
    if (defaultFoldKeys?.length || autoFoldDeep) {
      requestAnimationFrame(() => {
        if (!viewRef.current) {
          return;
        }
        if (defaultFoldKeys?.length) {
          foldMatchingKeys(viewRef.current, defaultFoldKeys);
        }
        if (autoFoldDeep) {
          foldDeepNested(viewRef.current);
        }
      });
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [readOnly, hasSlots, vscodePalette, vscodeTheme, disableLinting, autoFoldDeep]);

  // Update content when value changes from outside
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentContent = view.state.doc.toString();
    if (currentContent !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: value,
        },
      });
      // Re-apply auto-folding after content update.
      if (defaultFoldKeys?.length || autoFoldDeep) {
        requestAnimationFrame(() => {
          if (!viewRef.current) {
            return;
          }
          if (defaultFoldKeys?.length) {
            foldMatchingKeys(viewRef.current, defaultFoldKeys);
          }
          if (autoFoldDeep) {
            foldDeepNested(viewRef.current);
          }
        });
      }
    }
  }, [value, autoFoldDeep, defaultFoldKeys]);

  // Imperative handle: parent components can trigger expand-all without
  // poking the editor view directly.
  useImperativeHandle(
    ref,
    () => ({
      expandAll: () => {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        unfoldAll(view);
      },
    }),
    [],
  );

  // Push upstream slot data into the editor state
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !hasSlots) {
      return;
    }

    view.dispatch({
      effects: setUpstreamSlots.of(upstreamSlots ?? []),
    });
  }, [upstreamSlots, hasSlots]);

  // Handle copy for read-only mode
  const handleCopy = useCallback(() => {
    if (readOnly) {
      navigator.clipboard.writeText(value);
    }
  }, [readOnly, value]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'bg-background overflow-hidden h-full flex flex-col [&_.cm-editor]:flex-1 [&_.cm-editor]:min-h-0 [&_.cm-scroller]:overflow-auto',
        readOnly && 'cursor-default',
        className,
      )}
      style={minHeight ? { minHeight } : undefined}
      onDoubleClick={readOnly ? handleCopy : undefined}
      title={readOnly ? 'Double-click to copy' : undefined}
    >
      {hoveredSlotInfo &&
        createPortal(
          <SlotPopover
            slot={hoveredSlotInfo.slot}
            anchorRect={hoveredSlotInfo.rect}
            onMouseEnter={() => {
              // Cancel the leave timeout so popover stays open while hovered
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
              }
            }}
            onMouseLeave={() => {
              setHoveredSlotInfo(null);
            }}
          />,
          document.body,
        )}
    </div>
  );
});

// =====================================
// Slot Popover (React component rendered via portal)
// =====================================

function SlotPopover({
  slot,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: {
  slot: UpstreamSlot;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const portalClass = useFlowlibPortalClass();
  const Icon = getIconComponent(slot.sourceIcon);
  const typeLabel = formatNodeTypeLabel(slot.sourceType);

  // Position to the right of the gutter marker
  const top = anchorRect.top + anchorRect.height / 2;
  const left = anchorRect.right + 6;

  return (
    <div
      className={portalClass}
      style={{
        position: 'fixed',
        top,
        left,
        transform: 'translateY(-50%)',
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="rounded-lg border border-border bg-popover shadow-md min-w-[200px] max-w-[300px] overflow-hidden">
        <div className="px-3 py-1.5 border-b border-border bg-muted/50">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {slot.status === 'loading'
              ? 'Running upstream node…'
              : slot.status === 'resolved'
                ? 'Re-run upstream node'
                : slot.status === 'error'
                  ? 'Retry upstream node'
                  : 'Run upstream node'}
          </span>
        </div>
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 bg-primary/10 text-primary">
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs font-medium truncate text-popover-foreground">
              {slot.sourceLabel}
            </span>
            <span className="text-[11px] text-muted-foreground capitalize leading-snug">
              {typeLabel}
            </span>
          </div>
        </div>
        {slot.status === 'error' && slot.error && (
          <div className="px-3 py-1.5 border-t border-border bg-destructive/5">
            <span className="text-[11px] leading-snug text-destructive line-clamp-2">
              {slot.error}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
