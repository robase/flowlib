import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Save, Loader2 } from 'lucide-react';
import { InlineEdit } from './inline-edit';
import { cn } from '../../lib/utils';
import { usePluginRegistry } from '../../contexts/PluginRegistryContext';
import { useParams } from 'react-router';

interface FlowHeaderProps {
  flowName: string;
  onFlowNameChange: (name: string) => void;
  isDirty?: boolean;
  onSave?: () => Promise<boolean | void>;
  isSaving?: boolean;
  basePath?: string;
}

export function FlowHeader({
  flowName,
  onFlowNameChange,
  isDirty = false,
  onSave,
  isSaving = false,
  basePath = '',
}: FlowHeaderProps) {
  const { flowId } = useParams();
  const registry = usePluginRegistry();
  const flowHeaderActions = registry.headerActions.flowHeader ?? [];

  return (
    <header className="flex items-center justify-between px-6 border-b h-14 border-border bg-fl-background text-card-foreground">
      <div className="flex items-center gap-4">
        <InlineEdit
          value={flowName}
          onChange={onFlowNameChange}
          placeholder="Enter flow name"
          displayClassName="text-lg font-semibold text-card-foreground"
          inputClassName="h-8 w-64 text-lg font-semibold"
        />
        {isDirty ? (
          <Badge
            variant="secondary"
            className="gap-1.5 text-xs border-warning/40 bg-warning-muted text-warning"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Unsaved Changes
          </Badge>
        ) : (
          <span className="px-3 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
            Draft
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {flowHeaderActions
          .filter(
            (action) =>
              !action.permission || registry.checkPermission(action.permission, { flowId }),
          )
          .map((action, index) => (
            <action.component
              key={`flow-header-action-${index}`}
              flowId={flowId}
              basePath={basePath}
            />
          ))}
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={!isDirty || isSaving || !onSave}
          className={cn(
            isDirty && 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10',
          )}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Save className="w-4 h-4 mr-2" />
          )}
          Save
        </Button>
      </div>
    </header>
  );
}
