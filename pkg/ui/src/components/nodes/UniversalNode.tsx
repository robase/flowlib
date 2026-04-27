'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Card } from '../ui/card';
import { useNodeRegistry } from '../../contexts/NodeRegistryContext';
import { NodeExecutionStatus } from '@flowlib/core/types';
import type { NodeDefinition, NodeHandleDefinition } from '../../types/node-definition.types';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';
import { ProviderIcon } from '../shared/ProviderIcon';

// Stable style objects for Handles - avoids creating new objects on every render
const INPUT_HANDLE_STYLE = { top: '50%', transform: 'translate(-54%, -50%)' } as const;
const OUTPUT_HANDLE_STYLE_SINGLE = { top: '50%', transform: 'translate(54%, -50%)' } as const;
const OUTPUT_HANDLE_INNER_STYLE = { transform: 'translateX(54%)' } as const;

// Invisible handle styles for loading placeholder
const HIDDEN_HANDLE_STYLE_TRUE = {
  top: '30%',
  transform: 'translate(54%, -50%)',
  opacity: 0,
  width: 1,
  height: 1,
} as const;
const HIDDEN_HANDLE_STYLE_FALSE = {
  top: '70%',
  transform: 'translate(54%, -50%)',
  opacity: 0,
  width: 1,
  height: 1,
} as const;

const HANDLE_CLASS =
  '!bg-background !w-4 !h-4 !border-2 !border-muted-foreground !rounded-full !transition-all hover:!w-[18px] hover:!h-[18px] hover:!border-primary !shadow-none !ring-0';

// Height calculation for nodes with >2 outputs (e.g. switch with multiple cases)
const MULTI_OUTPUT_PADDING = 16; // px padding above first handle and below last
const MULTI_OUTPUT_HANDLE_SPACING = 24; // px between each output handle

/** Compute node height based on output count. Must match react-flow-renderer.service.ts */
function getNodeHeight(outputCount: number): number {
  if (outputCount <= 2) {
    return 60;
  }
  return MULTI_OUTPUT_PADDING * 2 + (outputCount - 1) * MULTI_OUTPUT_HANDLE_SPACING;
}

const DEFAULT_CATEGORY_COLOR = 'bg-muted text-muted-foreground';

function getProviderAccentColor(providerId?: string): string {
  switch (providerId) {
    case 'core':
      return 'border-l-blue-500';
    case 'http':
      return 'border-l-blue-500';
    case 'triggers':
      return 'border-l-emerald-500';
    case 'gmail':
    case 'google-drive':
    case 'google-docs':
    case 'google-sheets':
    case 'google-calendar':
      return 'border-l-amber-500';
    case 'slack':
      return 'border-l-purple-500';
    case 'github':
      return 'border-l-gray-500';
    case 'linear':
      return 'border-l-violet-500';
    case 'microsoft':
      return 'border-l-sky-500';
    case 'postgres':
      return 'border-l-teal-500';
    default:
      return 'border-l-muted-foreground';
  }
}

interface UniversalNodeData extends Record<string, unknown> {
  type?: string;
  display_name?: string;
  executionStatus?: NodeExecutionStatus;
  params?: {
    [key: string]: unknown;
  };
}

/**
 * Resolve output handles for a node. For nodes with `dynamicOutputs`, handles
 * are derived from the node's params (e.g. switch cases) instead of the static
 * definition. Falls back to the definition's `outputs` array.
 */
function resolveOutputHandles(
  definition: NodeDefinition,
  params: Record<string, unknown> | undefined,
): NodeHandleDefinition[] {
  if (!definition.dynamicOutputs) {
    return definition.outputs ?? [];
  }

  // Switch node: derive handles from params.cases + default
  if (definition.type === 'core.switch') {
    const cases = (params?.cases as Array<{ slug: string; label: string }>) ?? [];
    return [
      ...cases.map((c) => ({ id: c.slug, label: c.label, type: 'any' })),
      { id: 'default', label: 'Default', type: 'any' },
    ];
  }

  return definition.outputs ?? [];
}

/**
 * Loading placeholder shown while node definition is being fetched.
 * Renders a minimal node card with a spinner.
 * IMPORTANT: Must render Handle components to prevent React Flow edge errors.
 * The handles are invisible but allow edges to connect while loading.
 * We render ALL possible handle IDs that any node type might use.
 */
const NodeLoadingPlaceholder = memo(
  ({ data, selected }: { data: UniversalNodeData; selected: boolean }) => {
    const label = data.display_name || data.type || 'Loading...';
    const nodeType = data.type || 'Loading';

    // Compute dynamic height for switch nodes
    const switchOutputCount =
      data.type === 'core.switch' && Array.isArray(data.params?.cases)
        ? (data.params.cases as unknown[]).length + 1
        : 0;
    const placeholderHeight = switchOutputCount > 2 ? getNodeHeight(switchOutputCount) : 60;

    return (
      <Card
        className={`relative w-[240px] flex-row py-0 items-center cursor-move transition-colors bg-card hover:bg-card/80 ${
          selected
            ? 'border-blue-500 dark:border-blue-400 shadow-lg shadow-blue-500/25 dark:shadow-blue-400/30'
            : 'border-sidebar-ring hover:border-muted-foreground'
        }`}
        style={{ height: placeholderHeight }}
      >
        {/* Input handle */}
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          style={INPUT_HANDLE_STYLE}
          className={HANDLE_CLASS}
        />

        <div className="flex items-center gap-3 px-3 py-0 overflow-hidden">
          <div className="flex items-center justify-center w-10 h-10 shrink-0 rounded-xl bg-muted">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold tracking-tight truncate text-card-foreground">
              {label}
            </div>
            <div className="font-mono text-xs tracking-tight truncate text-muted-foreground">
              {nodeType}
            </div>
          </div>
        </div>

        {/* Standard output handle - visible */}
        <Handle
          id="output"
          type="source"
          position={Position.Right}
          style={OUTPUT_HANDLE_STYLE_SINGLE}
          className={HANDLE_CLASS}
        />

        {/* IF_ELSE node handles - hidden but functional */}
        <Handle
          id="true_output"
          type="source"
          position={Position.Right}
          style={HIDDEN_HANDLE_STYLE_TRUE}
        />
        <Handle
          id="false_output"
          type="source"
          position={Position.Right}
          style={HIDDEN_HANDLE_STYLE_FALSE}
        />

        {/* Switch node handles - derived from params.cases */}
        {data.type === 'core.switch' &&
          Array.isArray(data.params?.cases) &&
          (data.params.cases as Array<{ slug: string }>).map((c) => (
            <Handle
              key={c.slug}
              id={c.slug}
              type="source"
              position={Position.Right}
              style={{ ...HIDDEN_HANDLE_STYLE_TRUE, opacity: 0, width: 1, height: 1 }}
            />
          ))}
        {data.type === 'core.switch' && (
          <Handle
            id="default"
            type="source"
            position={Position.Right}
            style={{ ...HIDDEN_HANDLE_STYLE_FALSE, opacity: 0, width: 1, height: 1 }}
          />
        )}
      </Card>
    );
  },
);

NodeLoadingPlaceholder.displayName = 'NodeLoadingPlaceholder';

export const UniversalNode = memo(({ data, selected }: NodeProps) => {
  const typedData = data as UniversalNodeData;
  const nodeType = typedData.type || 'core.template_string';

  const { getNodeDefinition, isLoading: registryLoading } = useNodeRegistry();
  const definition = getNodeDefinition(nodeType);

  // Show loading placeholder if registry is still loading or definition not found
  if (registryLoading || !definition) {
    return <NodeLoadingPlaceholder data={typedData} selected={selected ?? false} />;
  }

  // Get display name from node data or fall back to definition label
  const label = typedData.display_name || definition.label || 'Unknown Node';
  const providerId = definition.provider?.id;
  const iconColorClass =
    providerId === 'core' || providerId === 'triggers'
      ? 'bg-accent text-primary'
      : DEFAULT_CATEGORY_COLOR;

  // Get handle definitions — for dynamicOutputs nodes, derive from params
  const inputHandle = definition.input;
  const outputs = resolveOutputHandles(definition, typedData.params);

  const hasIncomingHandle = !!inputHandle;

  // Three execution-visual states:
  //   running  — action.execute() is in flight: bright, fast border spin
  //   pending  — trace exists but action hasn't started (queued) OR batch
  //              submitted, awaiting external completion: dim, slow border spin
  //   idle     — no trace yet, or terminal state
  const isRunning = typedData.executionStatus === NodeExecutionStatus.RUNNING;
  const isPending =
    typedData.executionStatus === NodeExecutionStatus.PENDING ||
    typedData.executionStatus === NodeExecutionStatus.BATCH_SUBMITTED;
  const isSuccess = typedData.executionStatus === NodeExecutionStatus.SUCCESS;
  const isError = typedData.executionStatus === NodeExecutionStatus.FAILED;
  const isSkipped = typedData.executionStatus === NodeExecutionStatus.SKIPPED;

  const outputHandleConfigs = outputs.map((output, index) => {
    if (outputs.length === 1) {
      return { output, topStyle: '50%' };
    }
    // >2 outputs: use pixel positioning (node grows taller to fit)
    if (outputs.length > 2) {
      const topPx = MULTI_OUTPUT_PADDING + index * MULTI_OUTPUT_HANDLE_SPACING;
      return { output, topStyle: `${topPx}px` };
    }
    // 2 outputs (e.g. if_else): percentage positioning within standard 60px height
    const EDGE_OFFSET = 28; // Keep outer handles closer to node edges without clipping
    const availableSpace = 100 - EDGE_OFFSET * 2;
    const topPercent = EDGE_OFFSET + (index / (outputs.length - 1)) * availableSpace;
    return { output, topStyle: `${topPercent}%` };
  });

  const nodeHeight = getNodeHeight(outputs.length);

  return (
    <Card
      className={cn(
        'relative w-[200px] flex-row py-0 items-center cursor-move transition-colors node-hover-bg bg-card shadow-md border-l-4',
        getProviderAccentColor(definition?.provider?.id),
        // Default border
        !isRunning &&
          !isPending &&
          !isSuccess &&
          !isError &&
          !isSkipped &&
          'border-sidebar-ring hover:border-primary/80',
        // Running state - bright animated gradient border
        isRunning &&
          'node-running-border animate-node-border rounded-xl border-y border-r border-transparent',
        // Pending / batch-submitted - dimmer, slower spinning border
        isPending &&
          'node-pending-border animate-node-border-slow rounded-xl border-y border-r border-transparent',
        // Success state - green border
        isSuccess && 'border-y-2 border-r-2 border-success',
        // Error state - red border
        isError && 'border-y-2 border-r-2 border-destructive',
        // Skipped state - greyed out with dashed border
        isSkipped && 'border-y-2 border-r-2 border-dashed border-muted-foreground/50 opacity-50',
        // Selection state - change existing border color to blue for visibility
        selected &&
          !isRunning &&
          !isPending &&
          !isSuccess &&
          !isError &&
          !isSkipped &&
          'node-selected',
      )}
      style={{ height: nodeHeight }}
    >
      {/* Unified Input Handle */}
      {hasIncomingHandle && (
        <Handle
          id={inputHandle?.id || 'input'}
          type="target"
          position={Position.Left}
          style={INPUT_HANDLE_STYLE}
          className={HANDLE_CLASS}
        />
      )}

      <div className="flex items-center gap-2 px-3 py-0 overflow-hidden">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconColorClass}`}
        >
          <ProviderIcon
            providerId={definition.provider?.id}
            svgIcon={definition.provider?.svgIcon}
            icon={definition.icon}
            className="w-6 h-6"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold tracking-tight truncate text-card-foreground">
            {label}
          </div>
          <div className="font-mono text-xs tracking-tight truncate text-muted-foreground">
            {nodeType}
          </div>
        </div>
      </div>

      {/* Output Handles */}
      {outputHandleConfigs.map(({ output, topStyle }) => {
        // Show labels when there are multiple outputs (e.g., If/Else True/False)
        const showLabel = outputs.length > 1;
        return (
          <div
            key={output.id}
            className="absolute right-0"
            style={{ top: topStyle, transform: 'translateY(-50%)' }}
          >
            <div className="relative flex items-center">
              <Handle
                id={output.id}
                type="source"
                position={Position.Right}
                style={OUTPUT_HANDLE_INNER_STYLE}
                className="!relative !bg-background !w-4 !h-4 !border-2 !border-muted-foreground !rounded-full !transition-colors hover:!bg-muted hover:!border-foreground !shadow-none !ring-0"
              />
              {showLabel && (
                <div className="absolute px-1 text-xs border rounded left-8 text-card-foreground whitespace-nowrap bg-card border-sidebar-ring">
                  {output.label}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
});

UniversalNode.displayName = 'UniversalNode';
