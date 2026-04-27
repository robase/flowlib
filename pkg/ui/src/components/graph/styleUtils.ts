import { cn } from '../../lib/utils';
import { NodeExecutionStatus } from '@flowlib/core/types';

// Utility functions for styling nodes and edges, inspired by Flowlib

export type NodeType =
  | 'ChatInput'
  | 'TextInput'
  | 'Input'
  | 'ChatOutput'
  | 'TextOutput'
  | 'Output'
  | 'OpenAIModel'
  | 'AnthropicModel'
  | 'LLM'
  | 'Prompt'
  | 'PromptTemplate'
  | 'Agent'
  | 'Memory'
  | 'Tool'
  | 'Chain'
  | 'Retriever'
  | 'Embedding'
  | 'VectorStore'
  | 'DocumentLoader' // Added based on Flowlib's categories
  | 'TextSplitter' // Added based on Flowlib's categories
  | 'Note'
  | 'Unknown';

// Use proper status types from types package, plus UI-specific 'inactive' status
export type NodeStatus = 'idle' | 'running' | 'success' | 'error' | 'inactive';

// Map execution status to UI status
export const mapExecutionStatusToNodeStatus = (
  status: NodeExecutionStatus | string,
): NodeStatus => {
  switch (status) {
    case NodeExecutionStatus.SUCCESS:
    case 'SUCCESS':
      return 'success';
    case NodeExecutionStatus.FAILED:
    case 'FAILED':
      return 'error';
    case NodeExecutionStatus.RUNNING:
    case 'RUNNING':
      return 'running';
    case NodeExecutionStatus.PENDING:
    case 'PENDING':
      return 'running';
    case NodeExecutionStatus.SKIPPED:
    case 'SKIPPED':
      return 'inactive';
    // Handle additional execution statuses that might not be in NodeExecutionStatus
    case 'PAUSED':
    case 'PAUSED_FOR_BATCH':
      return 'running'; // Show as running but with different visual indicator
    case 'CANCELLED':
      return 'error'; // Show as error with orange/yellow color
    default:
      return 'idle';
  }
};

// Flowlib-inspired color palette (simplified)
// Reference: https://github.com/flowlib-ai/flowlib/blob/main/src/frontend/src/utils/styleUtils.ts
// and https://github.com/flowlib-ai/flowlib/blob/main/src/frontend/src/style/index.css
export const langflowColors = {
  // Categories (using names from flowlib's nodeColorsName for consistency)
  emerald: { light: '#d1fae5', DEFAULT: '#10b981', dark: '#059669' }, // inputs
  sky: { light: '#dbeafe', DEFAULT: '#3b82f6', dark: '#2563eb' }, // outputs (using sky for blue from flowlib)
  fuchsia: { light: '#f5d0fe', DEFAULT: '#c026d3', dark: '#a21caf' }, // models
  amber: { light: '#fef3c7', DEFAULT: '#f59e0b', dark: '#d97706' }, // prompts
  orange: { light: '#fed7aa', DEFAULT: '#f97316', dark: '#ea580c' }, // chains
  red: { light: '#fee2e2', DEFAULT: '#ef4444', dark: '#dc2626' }, // agents
  cyan: { light: '#cffafe', DEFAULT: '#06b6d4', dark: '#0891b2' }, // memory
  lime: { light: '#ecfccb', DEFAULT: '#84cc16', dark: '#65a30d' }, // tools
  teal: { light: '#ccfbf1', DEFAULT: '#14b8a6', dark: '#0d9488' }, // vectorstores
  indigo: { light: '#e0e7ff', DEFAULT: '#6366f1', dark: '#4f46e5' }, // embeddings
  pink: { light: '#fce7f3', DEFAULT: '#ec4899', dark: '#db2777' }, // retrievers
  purple: { light: '#ede9fe', DEFAULT: '#8b5cf6', dark: '#7c3aed' }, // documentloaders (using purple as a distinct color)
  rose: { light: '#ffe4e6', DEFAULT: '#f43f5e', dark: '#e11d48' }, // textsplitters
  slate: { light: '#f1f5f9', DEFAULT: '#64748b', dark: '#475569' }, // generic/unknown

  // Status
  success: { DEFAULT: '#22c55e', light: '#dcfce7', dark: '#166534' }, // green-500
  error: { DEFAULT: '#ef4444', light: '#fee2e2', dark: '#991b1b' }, // red-500
  running: { DEFAULT: '#3b82f6', light: '#dbeafe', dark: '#1e40af' }, // blue-500

  // UI Elements
  border: 'hsl(var(--border))', // from shadcn/ui
  background: 'hsl(var(--background))', // from shadcn/ui
  foreground: 'hsl(var(--foreground))', // from shadcn/ui
  muted: 'hsl(var(--muted))', // from shadcn/ui
  mutedForeground: 'hsl(var(--muted-foreground))', // from shadcn/ui
  primary: 'hsl(var(--primary))', // from shadcn/ui
  secondary: 'hsl(var(--secondary))', // from shadcn/ui
};

// Mapping our NodeType to Flowlib's color names for consistency
export const nodeTypeToColorName: Record<NodeType, keyof typeof langflowColors> = {
  ChatInput: 'emerald',
  TextInput: 'emerald',
  Input: 'emerald',
  ChatOutput: 'sky',
  TextOutput: 'sky',
  Output: 'sky',
  OpenAIModel: 'fuchsia',
  AnthropicModel: 'fuchsia',
  LLM: 'fuchsia',
  Prompt: 'amber',
  PromptTemplate: 'amber',
  Agent: 'red',
  Memory: 'cyan',
  Tool: 'lime',
  Chain: 'orange',
  Retriever: 'pink',
  Embedding: 'indigo',
  VectorStore: 'teal',
  DocumentLoader: 'purple',
  TextSplitter: 'rose',
  Note: 'amber', // Notes can share prompt styling or have their own
  Unknown: 'slate',
};

// Get icon name (Lucide icon names) for different node types
// Reference: https://github.com/flowlib-ai/flowlib/blob/main/src/frontend/src/utils/styleUtils.ts nodeIconToDisplayIconMap
export const getNodeIconName = (type: NodeType, icon?: string): string => {
  if (icon && icon !== 'Default' /* Handle Flowlib's "Default" placeholder */) {
    // Attempt to map known Flowlib icon names to Lucide, or use directly if valid
    const langflowIconMap: Record<string, string> = {
      OpenAI: 'Bot', // Example, assuming 'Bot' is a Lucide icon
      MessagesSquare: 'MessagesSquare', // Already a Lucide icon
      // Add more mappings as identified from Flowlib's usage
    };
    if (langflowIconMap[icon]) {
      return langflowIconMap[icon];
    }
    // A simple check; ideally, we'd validate against all Lucide names
    if (icon.match(/^[A-Z][a-zA-Z0-9]+$/)) {
      return icon;
    }
  }

  switch (type) {
    case 'ChatInput':
    case 'TextInput':
    case 'Input':
      return 'Download'; // Flowlib: Download
    case 'ChatOutput':
    case 'TextOutput':
    case 'Output':
      return 'Upload'; // Flowlib: Upload
    case 'OpenAIModel':
    case 'AnthropicModel':
    case 'LLM':
      return 'BrainCircuit'; // Flowlib: BrainCircuit
    case 'Prompt':
    case 'PromptTemplate':
      return 'TerminalSquare'; // Flowlib: TerminalSquare
    case 'Agent':
      return 'Bot'; // Flowlib: Bot
    case 'Memory':
      return 'Cpu'; // Flowlib: Cpu
    case 'Tool':
      return 'Hammer'; // Flowlib: Hammer
    case 'Chain':
      return 'Link'; // Flowlib: Link
    case 'Retriever':
      return 'FileSearch'; // Flowlib: FileSearch
    case 'Embedding':
      return 'Binary'; // Flowlib: Binary
    case 'VectorStore':
      return 'Layers'; // Flowlib: Layers (for vectorstores)
    case 'DocumentLoader':
      return 'Paperclip'; // Flowlib: Paperclip
    case 'TextSplitter':
      return 'Scissors'; // Flowlib: Scissors
    case 'Note':
      return 'StickyNote';
    default:
      return 'Cog'; // Default Lucide icon
  }
};

export const getNodeTailwindStyles = (type: NodeType, selected?: boolean) => {
  const colorName = nodeTypeToColorName[type] || 'slate';
  const colors =
    (langflowColors[colorName] as { light: string; DEFAULT: string; dark: string }) ||
    langflowColors.slate;

  // Node type colors using concrete Tailwind classes
  const getNodeTypeStyles = (type: NodeType) => {
    switch (type) {
      case 'ChatInput':
      case 'TextInput':
      case 'Input':
        return 'border-emerald-500 dark:border-emerald-400';
      case 'ChatOutput':
      case 'TextOutput':
      case 'Output':
        return 'border-blue-500 dark:border-blue-400';
      case 'OpenAIModel':
      case 'AnthropicModel':
      case 'LLM':
        return 'border-purple-500 dark:border-purple-400';
      case 'Prompt':
      case 'PromptTemplate':
        return 'border-amber-500 dark:border-amber-400';
      case 'Agent':
        return 'border-red-500 dark:border-red-400';
      case 'Memory':
        return 'border-cyan-500 dark:border-cyan-400';
      case 'Tool':
        return 'border-lime-500 dark:border-lime-400';
      case 'Chain':
        return 'border-orange-500 dark:border-orange-400';
      case 'Retriever':
        return 'border-pink-500 dark:border-pink-400';
      case 'Embedding':
        return 'border-indigo-500 dark:border-indigo-400';
      case 'VectorStore':
        return 'border-teal-500 dark:border-teal-400';
      case 'DocumentLoader':
        return 'border-violet-500 dark:border-violet-400';
      case 'TextSplitter':
        return 'border-rose-500 dark:border-rose-400';
      case 'Note':
        return 'border-yellow-500 dark:border-yellow-400';
      default:
        return 'border-border';
    }
  };

  return {
    card: cn(
      // Base card styling with explicit classes
      'relative bg-card backdrop-blur-sm',
      'border-2 rounded-xl shadow-md hover:shadow-xl',
      'transition-all duration-300 ease-out',
      'hover:bg-muted/50',
      // Node type specific border color
      getNodeTypeStyles(type),
      // Selected state
      selected &&
        '!ring-2 !ring-blue-500 !ring-offset-2 !ring-offset-background !shadow-2xl !scale-[1.02]',
    ),
    header: cn(
      'p-3 pb-2 border-b border-border/30 bg-gradient-to-b from-muted/10 to-transparent',
      'rounded-t-xl',
    ),
    iconContainer: cn(
      'flex h-8 w-8 items-center justify-center rounded-lg',
      'bg-gradient-to-br from-muted/40 to-muted/20 border border-border/20',
      'shadow-sm',
    ),
    icon: cn('transition-colors duration-200', `text-[${colors.DEFAULT}]`),
    title: 'font-semibold text-sm text-foreground truncate leading-tight',
    typeBadge: cn(
      'text-xs px-2 py-0.5 rounded-full',
      'bg-gradient-to-r from-muted/60 to-muted/40',
      'text-muted-foreground border border-border/40',
      'shadow-sm font-medium',
    ),
    description: 'text-xs text-muted-foreground leading-relaxed py-1',
    parametersSection: 'space-y-2',
    parameterTitle: 'text-xs font-semibold text-foreground/90 mb-1.5 flex items-center gap-1',
    parameterValue: cn(
      'text-xs text-foreground/90 bg-muted/40 rounded-lg px-3 py-2',
      'font-mono border border-border/30 shadow-sm',
      'transition-colors duration-200 hover:bg-muted/60',
    ),
    handleBase: '!w-3 !h-3 !border-2',
    categoryColorName: colorName,
    categoryDefaultColor: colors.DEFAULT,
  };
};

// Get node color for minimap
export const getNodeMinimapColor = (nodeType: NodeType): string => {
  const colorName = nodeTypeToColorName[nodeType] || 'slate';
  const colors =
    (langflowColors[colorName] as { light: string; DEFAULT: string; dark: string }) ||
    langflowColors.slate;
  return colors.DEFAULT;
};

// Status styling using concrete Tailwind classes
export const getNodeStatusStyles = (status: NodeStatus | undefined, _baseBorderColor: string) => {
  switch (status) {
    case 'running':
      return cn('!border-4 !border-blue-600 !shadow-xl !shadow-blue-500/40 animate-pulse');
    case 'success':
      return cn(
        '!border-4 !border-green-600 !shadow-xl !shadow-green-500/40',
        'bg-gradient-to-br from-white to-green-50 dark:from-gray-900 dark:to-green-950',
      );
    case 'error':
      return cn(
        '!border-4 !border-red-600 !shadow-xl !shadow-red-500/40',
        'bg-gradient-to-br from-white to-red-50 dark:from-gray-900 dark:to-red-950',
      );
    default:
      return ''; // Use default border from component
  }
};

// Truncate text with ellipsis
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
};

// Parse node type from string - this seems fine, ensure it covers all your types
export const parseNodeType = (type: string): NodeType => {
  const typeMap: Record<string, NodeType> = {
    chatinput: 'ChatInput',
    textinput: 'TextInput',
    chatoutput: 'ChatOutput',
    textoutput: 'TextOutput',
    openaimodel: 'OpenAIModel',
    anthropicmodel: 'AnthropicModel',
    prompttemplate: 'PromptTemplate',
    vectorstore: 'VectorStore',
    documentloader: 'DocumentLoader',
    textsplitter: 'TextSplitter',
    // Add all type string variations from your actual node data if they differ from NodeType values
  };

  const normalizedType = type.toLowerCase().replace(/[^a-z0-9]/g, ''); // Allow numbers for e.g. gpt-3.5
  if (typeMap[normalizedType]) {
    return typeMap[normalizedType];
  }
  // Check if the original type string is a valid NodeType
  const allNodeTypes = [
    'ChatInput',
    'TextInput',
    'Input',
    'ChatOutput',
    'TextOutput',
    'Output',
    'OpenAIModel',
    'AnthropicModel',
    'LLM',
    'Prompt',
    'PromptTemplate',
    'Agent',
    'Memory',
    'Tool',
    'Chain',
    'Retriever',
    'Embedding',
    'VectorStore',
    'DocumentLoader',
    'TextSplitter',
    'Note',
    'Unknown',
  ];
  if (allNodeTypes.includes(type as NodeType)) {
    return type as NodeType;
  }
  return 'Unknown';
};

// Helper to get specific color values for dynamic Tailwind classes if needed
// Tailwind JIT might not pick up dynamically constructed class names like border-[${color}]
// This is a fallback or for cases where direct hex/rgb is needed.
export const getRawNodeColors = (type: NodeType) => {
  const colorName = nodeTypeToColorName[type] || 'slate';
  return (
    (langflowColors[colorName] as { light: string; DEFAULT: string; dark: string }) ||
    langflowColors.slate
  );
};
