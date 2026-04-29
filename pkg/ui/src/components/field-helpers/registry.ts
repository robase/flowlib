import type { FieldHelperSpec } from '../../types/node-definition.types';
import type { HelperRenderer } from './types';
import { AsyncPickerHelper } from './AsyncPickerHelper';
import { DateHelper } from './DateHelper';
import { JsonFormatHelper } from './JsonFormatHelper';

/**
 * Registry of field helper renderers keyed on `helper.kind`. Unknown kinds
 * resolve to `undefined` and the field renders without an adornment, which
 * keeps the system forward-compatible: an old UI can ignore future helper
 * kinds gracefully without breaking the field.
 */
const registry: Partial<Record<FieldHelperSpec['kind'], HelperRenderer>> = {
  'async-picker': AsyncPickerHelper,
  date: DateHelper,
  'json-format': JsonFormatHelper,
};

export function getHelperRenderer(kind: FieldHelperSpec['kind']): HelperRenderer | undefined {
  return registry[kind];
}

export function registerHelperRenderer(
  kind: FieldHelperSpec['kind'],
  renderer: HelperRenderer,
): void {
  registry[kind] = renderer;
}
