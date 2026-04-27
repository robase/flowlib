import { useEffect, useCallback, useRef } from 'react';
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { useFlowEditorStore } from './flow-editor.store';
import { useNodeRegistry } from '~/contexts/NodeRegistryContext';
import { generateUniqueDisplayName, generateUniqueReferenceId } from '~/utils/nodeReferenceUtils';
import type { ClipboardData, ClipboardNode, ClipboardEdge } from './use-copy-paste.types';
import { emitSdkSource, parseSDKText, type ParsedFragment } from '@flowlib/sdk';
import type { DbFlowNode, DbFlowEdge } from '@flowlib/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseCopyPasteOptions {
  flowId: string;
  reactFlowInstance: ReactFlowInstance | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEBUG_PREFIX = '[copy-paste]';
function log(...args: unknown[]): void {
  console.debug(DEBUG_PREFIX, ...args);
}

/** Deep clone JSON-safe data */
function cloneData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}

/** Check if a keyboard event target is in an editable context (inputs, modals, etc.) */
function isEditingContext(el: HTMLElement): boolean {
  if (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  ) {
    return true;
  }
  if (el.closest('.cm-editor') || el.closest('[role="dialog"]')) {
    return true;
  }
  return false;
}

/**
 * Strip credential IDs from params (used for cross-flow paste).
 * Also strips credentialId from nested addedTools params.
 */
function stripCredentials(params: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...params };
  delete cleaned.credentialId;

  if (Array.isArray(cleaned.addedTools)) {
    cleaned.addedTools = (cleaned.addedTools as Array<Record<string, unknown>>).map((tool) => {
      const toolCleaned = { ...tool };
      if (typeof toolCleaned.params === 'object' && toolCleaned.params !== null) {
        const toolParams = { ...(toolCleaned.params as Record<string, unknown>) };
        delete toolParams.credentialId;
        toolCleaned.params = toolParams;
      }
      return toolCleaned;
    });
  }

  return cleaned;
}

/**
 * Regenerate instanceIds for addedTools in agent node params.
 */
function regenToolInstanceIds(params: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(params.addedTools)) {
    return params;
  }

  return {
    ...params,
    addedTools: (params.addedTools as Array<Record<string, unknown>>).map((tool) => ({
      ...tool,
      instanceId: nanoid(),
    })),
  };
}

/**
 * Render a clipboard selection as SDK source text.
 *
 * Bridges the copy path (React-Flow node/edge state) to the unified emitter
 * in `@flowlib/sdk`. For full-graph selections the result is the emitter's
 * complete output (imports + `export const ... = defineFlow({...})`);
 * for partial selections we strip the imports + defineFlow wrapper so the
 * pasted text plugs into an existing flow file.
 */
export function clipboardToSdkText(data: ClipboardData, isFullGraph: boolean): string {
  const dbNodes: DbFlowNode[] = data.nodes.map((cn) => ({
    id: cn.originalId,
    type: cn.type,
    referenceId: cn.data.reference_id,
    label: cn.data.display_name,
    params: (cn.data.params as Record<string, unknown>) ?? {},
    position: cn.absolutePosition ?? cn.relativePosition,
    ...(cn.data.mapper !== undefined ? { mapper: cn.data.mapper as Record<string, unknown> } : {}),
  }));

  const dbEdges: DbFlowEdge[] = data.edges.map((ce) => ({
    id: ce.originalId,
    source: ce.source,
    target: ce.target,
    ...(ce.sourceHandle ? { sourceHandle: ce.sourceHandle } : {}),
    ...(ce.targetHandle ? { targetHandle: ce.targetHandle } : {}),
  }));

  const { code } = emitSdkSource({ nodes: dbNodes, edges: dbEdges }, { flowName: 'copiedFlow' });
  if (isFullGraph) {
    return code;
  }

  // Partial selection → strip imports + defineFlow wrapper, keep just the
  // nodes/edges fragment so the user can paste into an existing file.
  return extractFragment(code);
}

/**
 * Extract the `nodes: [...], edges: [...]` fragment from a full emitter
 * output. Relies on the emitter's deterministic output shape — the wrapping
 * `export const ... = defineFlow({\n...\n});` always bookends the fragment.
 */
function extractFragment(fullSource: string): string {
  const startMatch = fullSource.match(/defineFlow\s*\(\s*\{\s*\n/);
  if (!startMatch || startMatch.index === undefined) {
    return fullSource;
  }
  const start = startMatch.index + startMatch[0].length;
  // Walk back from the closing `});` of the defineFlow call to find the end
  // of the fragment.
  const endIdx = fullSource.lastIndexOf('});', fullSource.lastIndexOf('});'));
  if (endIdx === -1) {
    return fullSource;
  }
  const inner = fullSource.slice(start, endIdx).trimEnd();
  // Strip the emitter's 2-space indent so fragments paste unindented.
  return inner
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n');
}

/**
 * Convert `parseSDKText` output into a ClipboardData structure that
 * materializePaste can consume.
 *
 * Parsed nodes come in primitives shape (`referenceId` + `type` + `params`,
 * optional `position` / `label` / `mapper`). The clipboard format needs a
 * stable `originalId` per node for edge correlation — we synthesise one from
 * the referenceId since the SDK source doesn't carry opaque DB ids.
 */
export function sdkResultToClipboard(
  { nodes, edges }: ParsedFragment,
  flowId: string,
): ClipboardData {
  // Compute absolute positions for each node (use parsed position or default horizontal layout).
  const positions = nodes.map((n, i) => n.position ?? { x: i * 250, y: 0 });

  const minX = positions.length > 0 ? Math.min(...positions.map((p) => p.x)) : 0;
  const minY = positions.length > 0 ? Math.min(...positions.map((p) => p.y)) : 0;

  // Stable mapping: referenceId → synthetic originalId used for edge lookup.
  const refToOriginalId = new Map<string, string>();
  for (const n of nodes) {
    refToOriginalId.set(n.referenceId, `paste-${n.referenceId}-${nanoid(6)}`);
  }

  const clipboardNodes: ClipboardNode[] = nodes.map((n, i) => {
    const pos = positions[i];
    const originalId = refToOriginalId.get(n.referenceId);
    if (!originalId) {
      throw new Error(`Missing originalId mapping for referenceId: ${n.referenceId}`);
    }
    return {
      originalId,
      type: n.type,
      relativePosition: { x: pos.x - minX, y: pos.y - minY },
      absolutePosition: pos,
      data: {
        display_name: n.label ?? n.referenceId,
        reference_id: n.referenceId,
        params: (n.params as Record<string, unknown>) ?? {},
        ...(n.mapper !== undefined && { mapper: n.mapper }),
      },
    };
  });

  const clipboardEdges: ClipboardEdge[] = [];
  for (const e of edges) {
    if (Array.isArray(e)) {
      const sourceId = refToOriginalId.get(e[0]);
      const targetId = refToOriginalId.get(e[1]);
      if (!sourceId || !targetId) {
        continue;
      }
      clipboardEdges.push({
        originalId: `edge-${nanoid()}`,
        source: sourceId,
        target: targetId,
        ...(e.length === 3 && e[2] ? { sourceHandle: e[2] } : {}),
      });
    } else {
      const sourceId = refToOriginalId.get(e.from);
      const targetId = refToOriginalId.get(e.to);
      if (!sourceId || !targetId) {
        continue;
      }
      clipboardEdges.push({
        originalId: `edge-${nanoid()}`,
        source: sourceId,
        target: targetId,
        ...(e.handle ? { sourceHandle: e.handle } : {}),
      });
    }
  }

  return {
    sourceFlowId: flowId,
    nodes: clipboardNodes,
    edges: clipboardEdges,
    copyTime: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCopyPaste({ flowId, reactFlowInstance }: UseCopyPasteOptions) {
  const clipboardRef = useRef<ClipboardData | null>(null);
  const mousePositionRef = useRef<{ x: number; y: number } | null>(null);
  const { getNodeDefinition } = useNodeRegistry();

  // Track mouse position over the react-flow canvas for paste anchoring
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // -------------------------------------------------------------------------
  // Serialize selection into ClipboardData
  // -------------------------------------------------------------------------
  const serializeSelection = useCallback((): {
    data: ClipboardData;
    isFullGraph: boolean;
  } | null => {
    const { nodes, edges } = useFlowEditorStore.getState();
    const selectedNodes = nodes.filter((n) => n.selected);
    log('serializeSelection', {
      totalNodes: nodes.length,
      selectedNodes: selectedNodes.length,
      totalEdges: edges.length,
    });
    if (selectedNodes.length === 0) {
      log('serializeSelection: no selected nodes, bailing');
      return null;
    }

    const isFullGraph = selectedNodes.length === nodes.length;

    const selectedIdSet = new Set(selectedNodes.map((n) => n.id));

    // Only capture edges where both endpoints are selected
    const internalEdges = edges.filter(
      (e) => selectedIdSet.has(e.source) && selectedIdSet.has(e.target),
    );

    // Compute bounding box origin
    const minX = Math.min(...selectedNodes.map((n) => n.position.x));
    const minY = Math.min(...selectedNodes.map((n) => n.position.y));

    const clipboardNodes: ClipboardNode[] = selectedNodes.map((node) => {
      const data = node.data as Record<string, unknown>;
      const params = (data.params as Record<string, unknown>) ?? {};

      return {
        originalId: node.id,
        type: (data.type as string) ?? node.type ?? 'unknown',
        relativePosition: {
          x: node.position.x - minX,
          y: node.position.y - minY,
        },
        absolutePosition: {
          x: node.position.x,
          y: node.position.y,
        },
        data: {
          display_name: (data.display_name as string) ?? '',
          reference_id: (data.reference_id as string) ?? '',
          params: cloneData(params),
          ...(data.mapper !== undefined && { mapper: cloneData(data.mapper) }),
          ...(data._loop !== undefined && { _loop: cloneData(data._loop) }),
        },
      };
    });

    const clipboardEdges: ClipboardEdge[] = internalEdges.map((edge) => ({
      originalId: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle !== undefined && { sourceHandle: edge.sourceHandle }),
      ...(edge.targetHandle !== undefined && { targetHandle: edge.targetHandle }),
    }));

    log('serializeSelection: built clipboard data', {
      isFullGraph,
      nodes: clipboardNodes.length,
      edges: clipboardEdges.length,
      types: clipboardNodes.map((n) => n.type),
    });

    return {
      data: {
        sourceFlowId: flowId,
        nodes: clipboardNodes,
        edges: clipboardEdges,
        copyTime: Date.now(),
      },
      isFullGraph,
    };
  }, [flowId]);

  // -------------------------------------------------------------------------
  // Materialize ClipboardData into the store
  // -------------------------------------------------------------------------
  const materializePaste = useCallback(
    (clipboard: ClipboardData, anchor: { x: number; y: number }) => {
      const { nodes: existingNodes } = useFlowEditorStore.getState();
      const isCrossFlow = clipboard.sourceFlowId !== flowId;
      const isEmptyFlow = existingNodes.length === 0;

      // Build the ID remap table
      const idMap = new Map<string, string>();
      for (const cn of clipboard.nodes) {
        idMap.set(cn.originalId, `${cn.type}-${nanoid()}`);
      }

      // Track nodes we add so dedup works across the paste batch
      const batchNodes: Array<{ data?: { display_name?: string; reference_id?: string } }> = [
        ...existingNodes,
      ];

      const skippedNodeIds = new Set<string>();
      const newNodes: Node[] = [];

      for (const cn of clipboard.nodes) {
        // maxInstances check
        const definition = getNodeDefinition(cn.type);
        if (definition?.maxInstances !== undefined) {
          const currentCount = existingNodes.filter(
            (n) => (n.data as Record<string, unknown>)?.type === cn.type,
          ).length;
          const pastedCount = newNodes.filter(
            (n) => (n.data as Record<string, unknown>)?.type === cn.type,
          ).length;
          if (currentCount + pastedCount >= definition.maxInstances) {
            skippedNodeIds.add(cn.originalId);
            continue;
          }
        }

        const newId = idMap.get(cn.originalId);
        if (!newId) {
          continue;
        }
        const displayName = generateUniqueDisplayName(cn.data.display_name, batchNodes);
        const referenceId = generateUniqueReferenceId(displayName, batchNodes);

        let params = cloneData(cn.data.params);
        if (isCrossFlow) {
          params = stripCredentials(params);
        }
        params = regenToolInstanceIds(params);

        // When the flow is empty, use the absolute/content positions directly;
        // otherwise anchor relative positions to the cursor/viewport point.
        const position =
          isEmptyFlow && cn.absolutePosition
            ? { x: cn.absolutePosition.x, y: cn.absolutePosition.y }
            : { x: anchor.x + cn.relativePosition.x, y: anchor.y + cn.relativePosition.y };

        const node: Node = {
          id: newId,
          type: cn.type,
          position,
          selected: true,
          data: {
            id: newId,
            type: cn.type,
            display_name: displayName,
            reference_id: referenceId,
            status: 'idle',
            params,
            ...(cn.data.mapper !== undefined && { mapper: cloneData(cn.data.mapper) }),
            ...(cn.data._loop !== undefined && { _loop: cloneData(cn.data._loop) }),
          },
        };

        newNodes.push(node);
        batchNodes.push(node);
      }

      // Remap edges — drop any whose endpoint was skipped
      const newEdges: Edge[] = [];
      for (const ce of clipboard.edges) {
        if (skippedNodeIds.has(ce.source) || skippedNodeIds.has(ce.target)) {
          continue;
        }
        const newSource = idMap.get(ce.source);
        const newTarget = idMap.get(ce.target);
        if (!newSource || !newTarget) {
          continue;
        }

        newEdges.push({
          id: `edge-${nanoid()}`,
          source: newSource,
          target: newTarget,
          ...(ce.sourceHandle !== undefined && { sourceHandle: ce.sourceHandle }),
          ...(ce.targetHandle !== undefined && { targetHandle: ce.targetHandle }),
        });
      }

      log('materializePaste: results', {
        anchor,
        isCrossFlow,
        isEmptyFlow,
        addedNodes: newNodes.length,
        addedEdges: newEdges.length,
        skippedNodes: skippedNodeIds.size,
      });

      if (newNodes.length > 0) {
        useFlowEditorStore.getState().pasteNodesAndEdges(newNodes, newEdges);
      }

      if (skippedNodeIds.size > 0) {
        log('materializePaste: some nodes skipped due to maxInstances', [...skippedNodeIds]);
      }
    },
    [flowId, getNodeDefinition],
  );

  // -------------------------------------------------------------------------
  // Compute paste anchor point
  // -------------------------------------------------------------------------
  const getPasteAnchor = useCallback(
    (offset?: { x: number; y: number }): { x: number; y: number } => {
      if (offset) {
        return offset;
      }

      // Try to paste at mouse cursor position in flow coords
      if (reactFlowInstance && mousePositionRef.current) {
        return reactFlowInstance.screenToFlowPosition(mousePositionRef.current);
      }

      // Fallback: center of viewport
      if (reactFlowInstance) {
        return reactFlowInstance.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      }

      return { x: 250, y: 150 };
    },
    [reactFlowInstance],
  );

  // -------------------------------------------------------------------------
  // Read clipboard (in-memory first → system SDK parse fallback)
  // -------------------------------------------------------------------------
  const readClipboard = useCallback(async (): Promise<ClipboardData | null> => {
    // Prefer in-memory ref — has correct relative positions from serializeSelection.
    // This covers same-session copy/paste (the common case).
    if (clipboardRef.current) {
      log('readClipboard: using in-memory ref', {
        nodes: clipboardRef.current.nodes.length,
        edges: clipboardRef.current.edges.length,
        sourceFlowId: clipboardRef.current.sourceFlowId,
      });
      return clipboardRef.current;
    }

    // Fall back to system clipboard — handles cross-app paste (SDK text from
    // a text editor, another browser tab, etc.)
    try {
      const text = await navigator.clipboard.readText();
      log('readClipboard: system clipboard read', {
        textLength: text.length,
        preview: text.slice(0, 120),
      });
      const parsed = parseSDKText(text);
      log('readClipboard: parseSDKText result', {
        nodes: parsed.nodes.length,
        edges: parsed.edges.length,
      });
      if (parsed.nodes.length > 0) {
        return sdkResultToClipboard(parsed, flowId);
      }
    } catch (err) {
      log('readClipboard: failed', err);
    }

    log('readClipboard: nothing usable found');
    return null;
  }, [flowId]);

  // -------------------------------------------------------------------------
  // Write to clipboard (system + in-memory)
  // -------------------------------------------------------------------------
  const writeClipboard = useCallback(async (data: ClipboardData, isFullGraph: boolean) => {
    clipboardRef.current = data;
    log('writeClipboard: in-memory ref set', {
      nodes: data.nodes.length,
      edges: data.edges.length,
      isFullGraph,
    });
    try {
      // Write SDK code to the system clipboard so pasting into a text editor
      // (VS Code, etc.) produces importable TypeScript helper calls.
      // Internal paste always reads from clipboardRef (in-memory).
      //
      // Full-graph selections emit a complete runnable `.flow.ts`. Partial
      // selections emit just the nodes/edges fragment so the user can paste
      // into an existing flow file.
      const sdkText = clipboardToSdkText(data, isFullGraph);
      log('writeClipboard: emitted SDK text', {
        length: sdkText.length,
        preview: sdkText.slice(0, 200),
      });
      await navigator.clipboard.writeText(sdkText);
      log('writeClipboard: system clipboard write ok');
    } catch (err) {
      log('writeClipboard: system clipboard write failed', err);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------

  const copy = useCallback(async () => {
    log('copy: invoked');
    const selection = serializeSelection();
    if (!selection) {
      log('copy: no selection, aborting');
      return;
    }
    await writeClipboard(selection.data, selection.isFullGraph);
    log('copy: done');
  }, [serializeSelection, writeClipboard]);

  const paste = useCallback(async () => {
    log('paste: invoked');
    const clipboard = await readClipboard();
    if (!clipboard) {
      log('paste: nothing to paste, aborting');
      return;
    }
    const anchor = getPasteAnchor();
    log('paste: anchor', anchor);
    materializePaste(clipboard, anchor);
    log('paste: done');
  }, [readClipboard, getPasteAnchor, materializePaste]);

  const cut = useCallback(async () => {
    log('cut: invoked');
    const selection = serializeSelection();
    if (!selection) {
      log('cut: no selection, aborting');
      return;
    }
    await writeClipboard(selection.data, selection.isFullGraph);

    const selectedIds = useFlowEditorStore
      .getState()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id);

    log('cut: removing nodes', { count: selectedIds.length });
    if (selectedIds.length > 0) {
      useFlowEditorStore.getState().removeNodes(selectedIds);
    }
  }, [serializeSelection, writeClipboard]);

  const duplicate = useCallback(() => {
    const selection = serializeSelection();
    if (!selection) {
      return;
    }

    // Don't write to system clipboard — duplicate is internal
    clipboardRef.current = selection.data;

    // Compute offset from original positions
    const { nodes } = useFlowEditorStore.getState();
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) {
      return;
    }

    const minX = Math.min(...selectedNodes.map((n) => n.position.x));
    const minY = Math.min(...selectedNodes.map((n) => n.position.y));

    materializePaste(selection.data, { x: minX + 50, y: minY + 50 });
  }, [serializeSelection, materializePaste]);

  const deleteSelection = useCallback(() => {
    const selectedIds = useFlowEditorStore
      .getState()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id);

    if (selectedIds.length > 0) {
      useFlowEditorStore.getState().removeNodes(selectedIds);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard handler
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;

      // Only handle when focus is on the ReactFlow canvas, not on editable elements
      const isOnCanvas = el.closest('.react-flow') !== null;
      const isBodyFocused = el.tagName === 'BODY';
      const isEditing = isEditingContext(el);

      const isModKey = e.metaKey || e.ctrlKey;
      const isClipboardKey =
        isModKey && (e.key === 'c' || e.key === 'x' || e.key === 'v' || e.key === 'd');
      if (isClipboardKey || e.key === 'Delete' || e.key === 'Backspace') {
        log('keydown', {
          key: e.key,
          mod: isModKey,
          targetTag: el.tagName,
          isOnCanvas,
          isBodyFocused,
          isEditing,
        });
      }

      if ((!isOnCanvas && !isBodyFocused) || isEditing) {
        if (isClipboardKey) {
          log('keydown: gated out (not-on-canvas or editing)');
        }
        return;
      }

      // If the user has a text selection *outside* the react-flow canvas
      // (e.g. AI chat output, config panels), let the browser handle
      // copy/cut natively. A stray selection inside the canvas — commonly
      // a side-effect of drag-selecting nodes over their labels — is
      // treated as no selection so node-copy still wins.
      const sel = window.getSelection();
      const selText = sel?.toString() ?? '';
      let selInsideCanvas = false;
      if (selText.length > 0 && sel && sel.rangeCount > 0) {
        const container = sel.getRangeAt(0).commonAncestorContainer;
        const containerEl =
          container.nodeType === Node.ELEMENT_NODE
            ? (container as Element)
            : container.parentElement;
        selInsideCanvas = !!containerEl?.closest('.react-flow');
      }
      const hasExternalTextSelection = selText.length > 0 && !selInsideCanvas;

      if (isClipboardKey) {
        log('keydown: selection state', {
          selTextLength: selText.length,
          selInsideCanvas,
          hasExternalTextSelection,
        });
      }

      const isMod = isModKey;

      if (isMod && e.key === 'c') {
        if (hasExternalTextSelection) {
          log('c: deferring to native (external text selection)');
          return;
        }
        e.preventDefault();
        if (selInsideCanvas) {
          log('c: clearing stray canvas text selection');
          sel?.removeAllRanges();
        }
        await copy();
      } else if (isMod && e.key === 'x') {
        if (hasExternalTextSelection) {
          log('x: deferring to native (external text selection)');
          return;
        }
        e.preventDefault();
        if (selInsideCanvas) {
          log('x: clearing stray canvas text selection');
          sel?.removeAllRanges();
        }
        await cut();
      } else if (isMod && e.key === 'v') {
        e.preventDefault();
        await paste();
      } else if (isMod && e.key === 'd') {
        e.preventDefault();
        duplicate();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [copy, cut, paste, duplicate, deleteSelection]);
}
