import { useCallback } from 'react';
import { useReactFlow, type Node } from '@xyflow/react';
import { useNodeRegistry } from '~/contexts/NodeRegistryContext';
import { useFlowEditorStore } from './flow-editor.store';
import { generateUniqueDisplayName, generateUniqueReferenceId } from '~/utils/nodeReferenceUtils';
import { findVisiblePlacementPosition, NODE_HEIGHT, NODE_WIDTH } from './node-placement';

/**
 * Encapsulates the logic for creating new nodes from the sidebar palette.
 * Handles: maxInstances enforcement, default param resolution, unique name
 * generation, and viewport-aware placement.
 */
export function useNodeCreation() {
  const { getNodeDefinition } = useNodeRegistry();
  const addNodeToStore = useFlowEditorStore((s) => s.addNode);
  const reactFlowInstance = useReactFlow();

  const createNewNode = useCallback(
    (type: string, options?: { position?: { x: number; y: number } }) => {
      const definition = getNodeDefinition(type);

      // Enforce maxInstances
      if (definition?.maxInstances !== null && definition?.maxInstances !== undefined) {
        const currentNodes = useFlowEditorStore.getState().nodes;
        const existingCount = currentNodes.filter(
          (n) => (n.data as Record<string, unknown>)?.type === type,
        ).length;
        if (existingCount >= definition.maxInstances) {
          return;
        }
      }

      const id = `${type}-${Date.now()}`;

      const fieldDefaults = (definition?.paramFields || []).reduce<Record<string, unknown>>(
        (acc, field) => {
          if (field.defaultValue !== undefined) {
            acc[field.name] = field.defaultValue;
          }
          return acc;
        },
        {},
      );

      const defaultParams = {
        ...definition?.defaultParams,
        ...fieldDefaults,
      };

      const baseDisplayName = definition?.label || type;
      const currentNodes = useFlowEditorStore.getState().nodes;
      const displayName = generateUniqueDisplayName(baseDisplayName, currentNodes);
      const referenceId = generateUniqueReferenceId(displayName, currentNodes);

      // When a drop position is provided (drag-and-drop from palette), center
      // the node on the cursor. Otherwise place at viewport center.
      // findVisiblePlacementPosition bumps bottom-left if the spot is taken.
      const anchor =
        options?.position ??
        reactFlowInstance.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      const startX = Math.round(anchor.x - NODE_WIDTH / 2);
      const startY = Math.round(anchor.y - NODE_HEIGHT / 2);

      const position = findVisiblePlacementPosition(startX, startY, currentNodes);

      const newNode: Node = {
        id,
        type,
        position,
        data: {
          display_name: displayName,
          reference_id: referenceId,
          type,
          params: defaultParams,
        },
      };

      addNodeToStore(newNode);
    },
    [getNodeDefinition, addNodeToStore, reactFlowInstance],
  );

  return createNewNode;
}
