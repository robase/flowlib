import { CodeMirrorNunjucksEditor } from '../../ui/codemirror-nunjucks-editor';

interface DroppableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  multiline?: boolean;
  rows?: number;
  fillAvailableHeight?: boolean;
  /** Upstream input data used to autocomplete `{{ ... }}` references. */
  inputData?: Record<string, unknown>;
}

/**
 * A text input that accepts drops from the DraggableJsonTree.
 * When a nunjucks path is dropped, it's inserted at the cursor position.
 *
 * For multiline inputs, uses CodeMirror with Nunjucks syntax highlighting.
 * For single-line inputs, uses a standard Input with drag-drop support.
 */
export function DroppableInput({
  value,
  onChange,
  placeholder,
  disabled,
  className = 'text-xs',
  id: _id,
  multiline = false,
  rows = 1,
  fillAvailableHeight = false,
  inputData,
}: DroppableInputProps) {
  return (
    <CodeMirrorNunjucksEditor
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      multiline={multiline}
      rows={rows}
      fillAvailableHeight={fillAvailableHeight}
      className={className}
      inputData={inputData}
    />
  );
}
