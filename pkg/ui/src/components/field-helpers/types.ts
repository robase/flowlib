import type { ComponentType } from 'react';
import type { NodeParamField, FieldHelperSpec } from '../../types/node-definition.types';

export interface HelperContext {
  /** Action / node type id — needed for server-backed loaders. */
  actionId?: string;
  /** All sibling field values — needed to resolve `dependsOn` for loaders. */
  formValues?: Record<string, unknown>;
  /** Portal container for floating popovers (e.g. inside dialogs). */
  portalContainer?: HTMLElement | null;
  /** True when the field's value is currently a `{{ template }}` literal — */
  /** purely-static helpers (date, json-format) self-disable in this case. */
  templateMode?: boolean;
}

export interface HelperAdornmentProps {
  field: NodeParamField;
  helper: FieldHelperSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  context: HelperContext;
}

export type HelperRenderer = ComponentType<HelperAdornmentProps>;
