import React from 'react';
import { useValidation } from '../../contexts/ValidationContext';
import {
  FlowValidationError,
  FlowValidationWarning,
  FLOW_VALIDATION_ERROR_TYPES,
} from '@flowlib/core/types';

// Helper function to format node ID to a short display name
const formatNodeId = (nodeId: string): string => {
  // Trim long UUIDs to something readable
  if (nodeId.length > 20) {
    return nodeId.slice(0, 8) + '…';
  }
  return nodeId;
};

interface ValidationPanelProps {
  className?: string;
}

export function ValidationPanel({ className = '' }: ValidationPanelProps) {
  const { validationResult, hasErrors, hasWarnings } = useValidation();

  if (!validationResult || (!hasErrors && !hasWarnings)) {
    return null;
  }

  const getErrorIcon = (error: FlowValidationError | FlowValidationWarning) => {
    if (error.severity === 'error') {
      return <span className="font-bold text-red-500">⚠️</span>;
    }
    return <span className="font-bold text-yellow-500">⚠</span>;
  };

  const getErrorTypeLabel = (type: string) => {
    switch (type) {
      // Errors (will cause execution failure)
      case FLOW_VALIDATION_ERROR_TYPES.ERROR.INVALID_EDGE_REFERENCE:
        return 'Invalid Edge Reference';
      case FLOW_VALIDATION_ERROR_TYPES.ERROR.SELF_REFERENCING_EDGE:
        return 'Self-Referencing Edge';
      case FLOW_VALIDATION_ERROR_TYPES.ERROR.CIRCULAR_DEPENDENCY:
        return 'Circular Dependency';
      case FLOW_VALIDATION_ERROR_TYPES.ERROR.VALIDATION_SYSTEM_ERROR:
        return 'Validation System Error';

      // Warnings (flow will run but something looks off)
      case FLOW_VALIDATION_ERROR_TYPES.WARNING.EMPTY_FLOW:
        return 'Empty Flow';
      case FLOW_VALIDATION_ERROR_TYPES.WARNING.ENTRY_NODE_HAS_INCOMING_EDGES:
        return 'Entry Node Has Incoming Edges';
      case FLOW_VALIDATION_ERROR_TYPES.WARNING.DISCONNECTED_NODE:
        return 'Disconnected Node';
      case FLOW_VALIDATION_ERROR_TYPES.WARNING.DUPLICATE_EDGE:
        return 'Duplicate Edge';

      // Generic fallback
      default:
        return 'Validation Issue';
    }
  };

  return (
    <div className={`bg-background border-l border-b h-full border-border p-4 ${className}`}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-foreground">Flow Validation</h3>
        <div className="text-sm text-muted-foreground">
          {hasErrors && (
            <span className="font-medium text-red-600">
              {validationResult.isValid ? 0 : validationResult.errors.length} error
              {validationResult.isValid ? 's' : validationResult.errors.length !== 1 ? 's' : ''}
            </span>
          )}
          {hasErrors && hasWarnings && <span className="mx-2">•</span>}
          {hasWarnings && (
            <span className="font-medium text-yellow-600">
              {validationResult.warnings?.length || 0} warning
              {(validationResult.warnings?.length || 0) !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {/* Errors */}
        {!validationResult.isValid &&
          validationResult.errors.map((error, index) => (
            <ValidationItem
              key={`error-${index}`}
              error={error}
              icon={getErrorIcon(error)}
              typeLabel={getErrorTypeLabel(error.type)}
            />
          ))}

        {/* Warnings */}
        {validationResult.warnings?.map((warning, index) => (
          <ValidationItem
            key={`warning-${index}`}
            error={warning}
            icon={getErrorIcon(warning)}
            typeLabel={getErrorTypeLabel(warning.type)}
          />
        ))}
      </div>
    </div>
  );
}

interface ValidationItemProps {
  error: FlowValidationError | FlowValidationWarning;
  icon: React.ReactNode;
  typeLabel: string;
}

function ValidationItem({ error, icon, typeLabel }: ValidationItemProps) {
  const severityClass =
    error.severity === 'error'
      ? 'border-destructive/20 bg-destructive/5'
      : 'border-border bg-muted/50';

  return (
    <div className={`border rounded-lg p-3 ${severityClass}`}>
      <div className="flex items-start space-x-2">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{typeLabel}</div>
          <div className="mt-1 text-sm text-muted-foreground">{error.message}</div>

          {/* Additional context information */}
          {'nodeId' in error && error.nodeId && (
            <div className="mt-2 text-xs text-muted-foreground">
              Node: {formatNodeId(error.nodeId)}
            </div>
          )}
          {'sourceNodeId' in error &&
          'targetNodeId' in error &&
          error.sourceNodeId &&
          error.targetNodeId ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Connection: {formatNodeId(error.sourceNodeId)} → {formatNodeId(error.targetNodeId)}
            </div>
          ) : null}

          {/* Show additional edges for multiple inputs */}
          {error.additionalContext &&
          'additionalEdgeIds' in error.additionalContext &&
          error.additionalContext.additionalEdgeIds ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Additional edges: {(error.additionalContext.additionalEdgeIds as string[]).join(', ')}
            </div>
          ) : null}

          {/* Show cycle path for circular dependencies */}
          {error.additionalContext &&
          'cyclePath' in error.additionalContext &&
          error.additionalContext.cyclePath ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Cycle: {(error.additionalContext.cyclePath as string[]).join(' → ')}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
