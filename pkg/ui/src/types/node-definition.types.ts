export interface NodeHandleDefinition {
  id: string;
  label: string;
  type: string; // e.g., "string", "object", "any"
  required?: boolean;
  description?: string;
}

export interface NodeParamField {
  name: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'select'
    | 'number'
    | 'boolean'
    | 'json'
    | 'code'
    | 'credential'
    | 'switch-cases';
  description?: string;
  placeholder?: string;
  defaultValue?: unknown;
  options?: { label: string; value: string | number; description?: string }[]; // For select
  required?: boolean;
  hidden?: boolean; // For internal params
  disabled?: boolean;
  extended?: boolean; // If true, field is shown in "More Options" collapsed section

  // Credential field options (only used when type="credential")
  credentialTypes?: ('oauth2' | 'api_key' | 'basic_auth' | 'database' | 'llm')[]; // Filter credentials by auth type or credential type
  oauth2Providers?: string[]; // Filter OAuth2 credentials by provider ID (e.g., "google")
  requiredScopes?: string[]; // OAuth2 scopes this node needs (used instead of provider defaults)

  // Dynamic option loading metadata (serialised from action's loadOptions config)
  /** When present, this field's options should be loaded from the server. */
  loadOptions?: {
    /** Sibling field names that trigger a reload when they change. */
    dependsOn: string[];
  };

  /**
   * Per-field UI helper (calendar picker, async combobox, JSON formatter, etc).
   * The frontend has a registry keyed on `kind`; unknown kinds render no
   * adornment so older UIs ignore future kinds gracefully.
   */
  helper?: FieldHelperSpec;
}

export type FieldHelperSpec =
  | { kind: 'date'; mode?: 'date' | 'datetime' | 'time'; min?: string; max?: string }
  | { kind: 'duration'; units?: ('ms' | 's' | 'm' | 'h' | 'd')[] }
  | { kind: 'json-format' }
  | { kind: 'color' }
  | { kind: 'cron' }
  | { kind: 'regex' }
  | { kind: 'recent-values'; max?: number }
  | {
      kind: 'async-picker';
      loader: string;
      dependsOn?: string[];
      multi?: boolean;
      labelTemplate?: string;
      searchable?: boolean;
    };

export interface NodeDefinition {
  /**
   * Node type identifier — a provider action ID (e.g. "core.model",
   * "gmail.list_messages").
   */
  type: string;
  label: string;
  description: string;
  icon?: string; // Icon name

  /**
   * Provider info for grouping in the node palette.
   * Actions populate this from their ProviderDef; legacy nodes may leave it undefined.
   */
  provider?: {
    id: string;
    name: string;
    icon?: string;
    /** Raw SVG markup for custom provider branding. Takes precedence over `icon`. */
    svgIcon?: string;
  };

  /**
   * Single unified input handle definition. Undefined when the node does not accept inbound edges (e.g. Flow Input node).
   */
  input?: NodeHandleDefinition;

  /**
   * Fixed output handles.
   * For nodes with `dynamicOutputs`, these are placeholders —
   * the frontend derives actual handles from the node's params.
   */
  outputs: NodeHandleDefinition[];

  /**
   * When true, output handles are derived from the node's params at render
   * time (e.g. switch node cases) instead of using the static `outputs` array.
   */
  dynamicOutputs?: boolean;

  /**
   * Configuration fields for the node (displayed in the sidebar/form).
   */
  paramFields: NodeParamField[];

  /**
   * Default values for parameters.
   */
  defaultParams?: Record<string, unknown>;

  /**
   * Maximum number of instances of this node type allowed per flow.
   * Undefined = unlimited.
   */
  maxInstances?: number;

  /**
   * When true, hide this node from the palette (deprecated but still executable).
   */
  hidden?: boolean;
}
