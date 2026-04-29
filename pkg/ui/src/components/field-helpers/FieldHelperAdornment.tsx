import type { NodeParamField } from '../../types/node-definition.types';
import { getHelperRenderer } from './registry';
import type { HelperContext } from './types';

interface FieldHelperAdornmentProps {
  field: NodeParamField;
  value: unknown;
  onChange: (value: unknown) => void;
  context: HelperContext;
}

/**
 * Resolves a field's `helper` spec to a registered renderer and renders
 * the adornment. Returns null if the field has no helper or the helper
 * kind is not registered.
 */
export function FieldHelperAdornment({
  field,
  value,
  onChange,
  context,
}: FieldHelperAdornmentProps) {
  if (!field.helper) {
    return null;
  }
  const Renderer = getHelperRenderer(field.helper.kind);
  if (!Renderer) {
    return null;
  }
  return (
    <Renderer
      field={field}
      helper={field.helper}
      value={value}
      onChange={onChange}
      context={context}
    />
  );
}
