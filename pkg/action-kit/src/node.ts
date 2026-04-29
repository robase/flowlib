/**
 * Node definition types — the legacy shape the frontend palette and node
 * executor registry consume. Actions are converted into `NodeDefinition`s
 * by the registry at registration time.
 */

export type NodeCategory =
  | 'Common'
  | 'AI'
  | 'Data'
  | 'Logic'
  | 'IO'
  | 'Integrations'
  | 'Custom'
  | 'Triggers';

export interface NodeHandleDefinition {
  id: string;
  label: string;
  type: string;
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
  options?: { label: string; value: string | number }[];
  required?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  extended?: boolean;

  credentialTypes?: ('oauth2' | 'api_key' | 'basic_auth' | 'database' | 'llm')[];
  oauth2Providers?: string[];
  requiredScopes?: string[];

  loadOptions?: {
    dependsOn: string[];
  };

  /**
   * Per-field UI helper. Frontend has a registry keyed on `kind`; unknown
   * kinds render as no adornment so older UIs ignore future kinds gracefully.
   * Mirrors `FieldHelperSpec` from `./action`.
   */
  helper?: import('./action').FieldHelperSpec;
}

export interface NodeDefinition {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  icon?: string;

  provider?: {
    id: string;
    name: string;
    icon?: string;
    svgIcon?: string;
  };

  input?: NodeHandleDefinition;

  outputs: NodeHandleDefinition[];

  dynamicOutputs?: boolean;

  paramFields: NodeParamField[];

  defaultParams?: Record<string, unknown>;

  searchTerms?: string[];

  maxInstances?: number;

  hidden?: boolean;
}
