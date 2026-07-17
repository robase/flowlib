import { useEffect, useRef } from 'react';
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
} from '@codemirror/view';
import { EditorState, Extension, RangeSetBuilder, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  autocompletion,
  completionKeymap,
  acceptCompletion,
  completionStatus,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from '@codemirror/autocomplete';
import { cn } from '../../lib/utils';
import {
  CODEMIRROR_IOSEVKA_FONT_STACK,
  useCodeMirrorVscodePalette,
  useCodeMirrorVscodeTheme,
  type CodeMirrorVscodePalette,
} from './codemirror-vscode-theme';

interface CodeMirrorNunjucksEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  fillAvailableHeight?: boolean;
  /**
   * Upstream input data, used to autocomplete `{{ ... }}` template references.
   * Top-level keys become variable suggestions; nested object keys drive
   * property-path completions (e.g. `{{ fetch_user.data.id }}`).
   */
  inputData?: Record<string, unknown>;
}

/** Short, human-readable type hint shown next to a completion. */
function describeValueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `array[${value.length}]`;
  }
  return typeof value;
}

/**
 * Completion source for Nunjucks `{{ ... }}` references, driven by the live
 * upstream input data. Only fires when the cursor sits inside an unclosed
 * `{{ ... }}` expression and is not in a filter (post-`|`) position.
 *
 * Supports arbitrary-depth property paths: `{{ fetch_user.data.address.city }}`.
 */
function getNunjucksCompletions(
  inputData: Record<string, unknown>,
  context: CompletionContext,
): CompletionResult | null {
  const before = context.state.sliceDoc(0, context.pos);

  // Must be inside an open {{ that isn't already closed before the cursor.
  const open = before.lastIndexOf('{{');
  if (open === -1 || before.indexOf('}}', open) !== -1) {
    return null;
  }

  const exprBefore = before.slice(open + 2);

  // Trailing dotted path token being typed (e.g. "fetch_user.data.ci").
  const pathText = (/[\w$.]*$/.exec(exprBefore) ?? [''])[0];

  // Don't suggest data variables where a filter name is expected (right after `|`).
  const charBeforePath = exprBefore
    .slice(0, exprBefore.length - pathText.length)
    .trimEnd()
    .slice(-1);
  if (charBeforePath === '|') {
    return null;
  }

  const segments = pathText.split('.');
  const lastSegment = segments[segments.length - 1];
  const navSegments = segments.slice(0, -1);

  // Walk into the input data along the already-typed path segments.
  let target: unknown = inputData;
  for (const segment of navSegments) {
    if (
      target &&
      typeof target === 'object' &&
      !Array.isArray(target) &&
      segment in (target as Record<string, unknown>)
    ) {
      target = (target as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }

  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return null;
  }

  const isTopLevel = navSegments.length === 0;
  // Avoid noise: at top level, only auto-pop once the user has typed something.
  if (isTopLevel && lastSegment === '' && !context.explicit) {
    return null;
  }

  const targetObj = target as Record<string, unknown>;
  const keys = Object.keys(targetObj).filter((k) => !lastSegment || k.startsWith(lastSegment));
  if (keys.length === 0) {
    return null;
  }

  const options: Completion[] = keys.map((key) => ({
    label: key,
    type: isTopLevel ? 'variable' : 'property',
    detail: describeValueType(targetObj[key]),
  }));

  return {
    from: context.pos - lastSegment.length,
    options,
    validFor: /^[\w$]*$/,
  };
}

// Custom decoration for nunjucks expressions {{ ... }}
const nunjucksBraceMark = Decoration.mark({
  class: 'cm-nunjucks-brace',
});

const nunjucksVariableMark = Decoration.mark({
  class: 'cm-nunjucks-variable',
});

const nunjucksFilterMark = Decoration.mark({
  class: 'cm-nunjucks-filter',
});

// Parse and decorate nunjucks expressions
function parseNunjucksDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc.toString();

  // Match {{ ... }} expressions
  const expressionRegex = /\{\{(.*?)\}\}/g;
  let match;

  while ((match = expressionRegex.exec(doc)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const inner = match[1];
    const innerStart = start + 2; // After {{

    // Highlight opening braces
    builder.add(start, start + 2, nunjucksBraceMark);

    // Parse the inner content for variables, properties, and filters
    // Simple parser for: variable.property.path | filter | filter2
    let inVariable = true;
    let wordStart = -1;

    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];

      if (char === ' ' || char === '\t' || char === '\n') {
        if (wordStart >= 0) {
          // End of a word
          const wordEnd = i;
          if (inVariable) {
            builder.add(innerStart + wordStart, innerStart + wordEnd, nunjucksVariableMark);
          } else {
            builder.add(innerStart + wordStart, innerStart + wordEnd, nunjucksFilterMark);
          }
          wordStart = -1;
        }
        continue;
      }

      if (char === '|') {
        // Filter separator
        if (wordStart >= 0) {
          const wordEnd = i;
          if (inVariable) {
            builder.add(innerStart + wordStart, innerStart + wordEnd, nunjucksVariableMark);
          } else {
            builder.add(innerStart + wordStart, innerStart + wordEnd, nunjucksFilterMark);
          }
          wordStart = -1;
        }
        inVariable = false;
        continue;
      }

      if (char === '.') {
        // Property separator within variable path
        if (wordStart >= 0) {
          builder.add(innerStart + wordStart, innerStart + i, nunjucksVariableMark);
          wordStart = -1;
        }
        continue;
      }

      if (wordStart < 0 && /[a-zA-Z_]/.test(char)) {
        wordStart = i;
      }
    }

    // Handle last word
    if (wordStart >= 0) {
      if (inVariable) {
        builder.add(innerStart + wordStart, innerStart + inner.length, nunjucksVariableMark);
      } else {
        builder.add(innerStart + wordStart, innerStart + inner.length, nunjucksFilterMark);
      }
    }

    // Highlight closing braces
    builder.add(end - 2, end, nunjucksBraceMark);
  }

  // Also highlight {% ... %} tags
  const tagRegex = /\{%(.*?)%\}/g;
  while ((match = tagRegex.exec(doc)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    builder.add(start, start + 2, nunjucksBraceMark);
    builder.add(end - 2, end, nunjucksBraceMark);
  }

  // Also highlight {# ... #} comments
  const commentRegex = /\{#(.*?)#\}/g;
  while ((match = commentRegex.exec(doc)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    builder.add(start, start + 2, nunjucksBraceMark);
    builder.add(end - 2, end, nunjucksBraceMark);
  }

  return builder.finish();
}

// Plugin to update decorations
const nunjucksDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = parseNunjucksDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = parseNunjucksDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

// Theme extension for styling
function createEditorTheme(palette: CodeMirrorVscodePalette) {
  return EditorView.theme({
    '&': {
      fontSize: '12px',
      fontFamily: CODEMIRROR_IOSEVKA_FONT_STACK,
    },
    '.cm-scroller, .cm-content, .cm-gutters, .cm-lineNumbers, .cm-tooltip': {
      fontFamily: CODEMIRROR_IOSEVKA_FONT_STACK,
    },
    '.cm-content': {
      padding: '8px',
    },
    '.cm-line': {
      padding: '0',
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
    '.cm-completionLabel': {
      fontSize: '12px',
    },
    '.cm-completionMatchedText': {
      fontWeight: '600',
      textDecoration: 'none',
    },
    '.cm-completionDetail': {
      color: palette.foregroundMuted,
      fontSize: '11px',
      fontStyle: 'normal',
    },
    '.cm-panels': {
      backgroundColor: palette.surface,
      color: palette.foreground,
      borderColor: palette.border,
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
    '.cm-placeholder': {
      color: palette.foregroundMuted,
      fontStyle: 'italic',
    },
    '.cm-nunjucks-brace': {
      color: palette.keyword,
      fontWeight: '600',
    },
    '.cm-nunjucks-variable': {
      color: palette.variable,
    },
    '.cm-nunjucks-filter': {
      color: palette.operator,
    },
  });
}

// Single-line theme (no line wrapping for single-line mode)
const singleLineTheme = EditorView.theme({
  '&': {
    minHeight: '2rem',
  },
  '.cm-content': {
    whiteSpace: 'nowrap',
    padding: '5px 8px',
  },
  '.cm-scroller': {
    overflow: 'hidden',
  },
  '.cm-line': {
    padding: '0',
  },
});

// Placeholder widget
class PlaceholderWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-placeholder';
    span.textContent = this.text;
    span.style.pointerEvents = 'none';
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

// Placeholder plugin that shows placeholder when empty
function placeholderPlugin(placeholder: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.getDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = this.getDecorations(update.view);
        }
      }

      getDecorations(view: EditorView): DecorationSet {
        if (view.state.doc.length === 0) {
          return Decoration.set([
            Decoration.widget({
              widget: new PlaceholderWidget(placeholder),
              side: 1,
            }).range(0),
          ]);
        }
        return Decoration.none;
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

export function CodeMirrorNunjucksEditor({
  value,
  onChange,
  readOnly = false,
  className,
  placeholder = '',
  disabled = false,
  multiline = false,
  rows = 3,
  fillAvailableHeight = false,
  inputData,
}: CodeMirrorNunjucksEditorProps) {
  const vscodePalette = useCodeMirrorVscodePalette();
  const vscodeTheme = useCodeMirrorVscodeTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValueRef = useRef(value);

  // Always read the latest input data without recreating the editor.
  const inputDataRef = useRef<Record<string, unknown>>(inputData ?? {});
  inputDataRef.current = inputData ?? {};

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
      highlightSpecialChars(),
      history(),
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
      nunjucksDecorationPlugin,
      autocompletion({
        override: [(ctx: CompletionContext) => getNunjucksCompletions(inputDataRef.current, ctx)],
        activateOnTyping: true,
        icons: false,
      }),
      // completionKeymap first so Enter/Arrows drive the popup when it's open.
      keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
    ];

    // Add placeholder
    if (placeholder) {
      extensions.push(placeholderPlugin(placeholder));
    }

    // Add multiline or single-line behavior
    if (multiline) {
      extensions.push(EditorView.lineWrapping);
    } else {
      extensions.push(singleLineTheme);
      // Prevent Enter key from creating new lines in single-line mode
      extensions.push(
        Prec.highest(
          keymap.of([
            {
              key: 'Enter',
              run: (view) => {
                // Accept the autocomplete suggestion if the popup is open;
                // otherwise consume Enter so single-line mode stays single-line.
                if (completionStatus(view.state) === 'active') {
                  return acceptCompletion(view);
                }
                return true;
              },
            },
          ]),
        ),
      );
    }

    if (readOnly || disabled) {
      extensions.push(EditorState.readOnly.of(true));
    } else {
      // Add update listener for editable mode
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            let newValue = update.state.doc.toString();
            // In single-line mode, remove any newlines
            if (!multiline) {
              newValue = newValue.replace(/\n/g, '');
            }
            onChangeRef.current(newValue);
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

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [readOnly, disabled, multiline, placeholder, vscodePalette, vscodeTheme]);

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
    }
  }, [value]);

  // Calculate height based on rows
  const maxHeight = multiline ? `${Math.max(rows * 2, 8)}em` : '2.25rem';

  return (
    <div
      ref={containerRef}
      className={cn(
        'rounded-md border bg-background text-sm',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        disabled && 'opacity-50 cursor-not-allowed',
        '[&_.cm-editor]:min-h-full [&_.cm-scroller]:overflow-auto',
        fillAvailableHeight && 'h-full min-h-0 [&_.cm-editor]:h-full [&_.cm-scroller]:h-full',
        className,
      )}
      style={
        fillAvailableHeight
          ? { height: '100%', overflow: 'hidden' }
          : { maxHeight, overflow: 'hidden' }
      }
    />
  );
}
