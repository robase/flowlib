import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Copy, Check, X } from 'lucide-react';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { useFlowEditorStore } from '~/stores/flow-editor.store';
import { useUIStore } from '~/stores/uiStore';
import { useFlow, useFlowVersions } from '~/api/flows.api';
import type { FlowlibDefinition } from '@flowlib/core/types';
import { transformToFlowlibDefinition } from '~/utils/flowTransformations';
import { emitSdkSource, SdkEmitError } from '@flowlib/sdk';
import {
  CODEMIRROR_IOSEVKA_FONT_STACK,
  useCodeMirrorVscodePalette,
  useCodeMirrorVscodeTheme,
} from '~/components/ui/codemirror-vscode-theme';

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 360;
const MAX_WIDTH = 900;

interface FlowCodePanelProps {
  flowId: string;
  /**
   * Where to source the flow definition from:
   * - 'editor' (default): live editor store, reflects unsaved edits.
   * - 'version': fetch the latest saved flow version.
   */
  source?: 'editor' | 'version';
  className?: string;
}

function toCamelCaseIdent(input: string): string {
  const camel = input
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
  if (!camel) {
    return 'myFlow';
  }
  const first = camel[0];
  const safe = /[a-zA-Z_$]/.test(first) ? camel : `my${camel[0].toUpperCase()}${camel.slice(1)}`;
  return `${safe.charAt(0).toLowerCase()}${safe.slice(1)}`;
}

export function FlowCodePanel({ flowId, source = 'editor', className }: FlowCodePanelProps) {
  const isOpen = useUIStore((s) => s.codePanelOpen);
  const setOpen = useUIStore((s) => s.setCodePanelOpen);

  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const editorFlowId = useFlowEditorStore((s) => s.flowId);
  const useEditor = source === 'editor' && editorFlowId === flowId && nodes.length > 0;

  const { data: flow } = useFlow(flowId);
  const { data: versionsResponse } = useFlowVersions(flowId, { pagination: { page: 1, limit: 1 } });
  const latestDefinition = versionsResponse?.data?.[0]?.flowlibDefinition as
    | FlowlibDefinition
    | undefined;

  const { code, error } = useMemo(() => {
    try {
      const def: FlowlibDefinition | undefined = useEditor
        ? transformToFlowlibDefinition(nodes, edges)
        : latestDefinition;
      if (!def) {
        return { code: '', error: null as string | null };
      }
      const baseName = flow?.name?.trim() ? toCamelCaseIdent(flow.name) : 'myFlow';
      const flowName = baseName.endsWith('Flow') ? baseName : `${baseName}Flow`;
      const result = emitSdkSource(def, { flowName });
      return { code: result.code, error: null as string | null };
    } catch (err) {
      const message =
        err instanceof SdkEmitError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return { code: '', error: message };
    }
  }, [useEditor, nodes, edges, latestDefinition, flow?.name]);

  // Resize
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isResizing = useRef(false);
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) {
          return;
        }
        const delta = startX - ev.clientX;
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        setPanelWidth(next);
      };
      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [panelWidth],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={cn(
        'relative flex flex-col h-full border-l border-border bg-imp-background text-card-foreground',
        className,
      )}
      style={{ width: panelWidth, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}
    >
      <div
        onMouseDown={startResize}
        className="absolute inset-y-0 left-0 z-20 w-1 transition-colors cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
      />
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-primary" />
          <span className="text-sm font-semibold">Code</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CopyCodeButton code={code} disabled={!!error || code.length === 0} />
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} title="Close">
            <X className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {error ? (
          <div className="h-full overflow-auto p-4 text-xs font-mono text-destructive whitespace-pre-wrap">
            {`// Cannot emit SDK source:\n// ${error}`}
          </div>
        ) : (
          <ReadOnlyTsViewer value={code} />
        )}
      </div>
    </div>
  );
}

function CopyCodeButton({ code, disabled }: { code: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [code]);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onCopy}
      disabled={disabled}
      title={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function ReadOnlyTsViewer({ value }: { value: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cmTheme = useCodeMirrorVscodeTheme();
  const palette = useCodeMirrorVscodePalette();

  const themeExtension = useMemo(
    () =>
      EditorView.theme({
        '&': {
          fontFamily: CODEMIRROR_IOSEVKA_FONT_STACK,
          fontSize: '12.5px',
          height: '100%',
        },
        '.cm-scroller, .cm-content, .cm-gutters, .cm-tooltip': {
          fontFamily: CODEMIRROR_IOSEVKA_FONT_STACK,
        },
        '.cm-content': { padding: '8px 0' },
        '.cm-line': { padding: '0 12px' },
        '.cm-gutters': {
          backgroundColor: 'transparent',
          borderRight: `1px solid ${palette.border}`,
          color: palette.foregroundMuted,
        },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { overflow: 'auto', height: '100%' },
      }),
    [palette],
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        javascript({ typescript: true, jsx: false }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
        cmTheme,
        themeExtension,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editor is recreated intentionally when theme changes
  }, [cmTheme, themeExtension]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={containerRef} className="h-full" />;
}

export default FlowCodePanel;
