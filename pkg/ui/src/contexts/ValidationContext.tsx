import React, { createContext, useContext, useState, ReactNode } from 'react';
import type {
  FlowValidationResult,
  FlowValidationError,
  FlowValidationWarning,
} from '@flowlib/core/types';

interface ValidationContextValue {
  validationResult: FlowValidationResult | null;
  setValidationResult: (result: FlowValidationResult | null) => void;
  clearValidation: () => void;

  // Helper methods for checking validation state
  hasErrors: boolean;
  hasWarnings: boolean;

  // Methods to get errors/warnings by element
  getNodeErrors: (nodeId: string) => FlowValidationError[];
  getNodeWarnings: (nodeId: string) => FlowValidationWarning[];
  getEdgeErrors: (edgeId: string) => FlowValidationError[];
  getEdgeWarnings: (edgeId: string) => FlowValidationWarning[];

  // Check if specific elements have validation issues
  isNodeInvalid: (nodeId: string) => boolean;
  isEdgeInvalid: (edgeId: string) => boolean;
  hasNodeWarnings: (nodeId: string) => boolean;
  hasEdgeWarnings: (edgeId: string) => boolean;
}

const ValidationContext = createContext<ValidationContextValue | null>(null);

export function ValidationProvider({ children }: { children: ReactNode }) {
  const [validationResult, setValidationResult] = useState<FlowValidationResult | null>(null);

  const clearValidation = () => setValidationResult(null);

  // Helper methods
  const hasErrors = validationResult
    ? !validationResult.isValid && validationResult.errors?.length > 0
    : false;
  const hasWarnings = validationResult ? (validationResult.warnings?.length || 0) > 0 : false;

  const getNodeErrors = (nodeId: string): FlowValidationError[] => {
    if (!validationResult || validationResult.isValid) {
      return [];
    }
    return validationResult.errors.filter(
      (error: FlowValidationError) =>
        error.nodeId === nodeId || error.sourceNodeId === nodeId || error.targetNodeId === nodeId,
    );
  };

  const getNodeWarnings = (nodeId: string): FlowValidationWarning[] => {
    if (!validationResult || !validationResult.warnings) {
      return [];
    }
    return validationResult.warnings.filter(
      (warning: FlowValidationWarning) =>
        warning.nodeId === nodeId ||
        warning.sourceNodeId === nodeId ||
        warning.targetNodeId === nodeId,
    );
  };

  const getEdgeErrors = (edgeId: string): FlowValidationError[] => {
    if (!validationResult || validationResult.isValid) {
      return [];
    }
    return validationResult.errors.filter((error: FlowValidationError) => error.edgeId === edgeId);
  };

  const getEdgeWarnings = (edgeId: string): FlowValidationWarning[] => {
    if (!validationResult || !validationResult.warnings) {
      return [];
    }
    return validationResult.warnings.filter(
      (warning: FlowValidationWarning) => warning.edgeId === edgeId,
    );
  };

  const isNodeInvalid = (nodeId: string): boolean => {
    return getNodeErrors(nodeId).length > 0;
  };

  const isEdgeInvalid = (edgeId: string): boolean => {
    return getEdgeErrors(edgeId).length > 0;
  };

  const hasNodeWarnings = (nodeId: string): boolean => {
    return getNodeWarnings(nodeId).length > 0;
  };

  const hasEdgeWarnings = (edgeId: string): boolean => {
    return getEdgeWarnings(edgeId).length > 0;
  };

  const value: ValidationContextValue = {
    validationResult,
    setValidationResult,
    clearValidation,
    hasErrors,
    hasWarnings,
    getNodeErrors,
    getNodeWarnings,
    getEdgeErrors,
    getEdgeWarnings,
    isNodeInvalid,
    isEdgeInvalid,
    hasNodeWarnings,
    hasEdgeWarnings,
  };

  return <ValidationContext.Provider value={value}>{children}</ValidationContext.Provider>;
}

export function useValidation() {
  const context = useContext(ValidationContext);
  if (!context) {
    throw new Error('useValidation must be used within a ValidationProvider');
  }
  return context;
}
