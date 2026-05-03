/**
 * ConnectFlowForm — Form to configure version control sync for a flow.
 */

import { useState } from 'react';
import { GitBranch, X } from 'lucide-react';
import { useConfigureSync } from '../hooks/useFlowSync';
import type { VcSyncMode, VcSyncDirection } from '../../shared/types';

interface ConnectFlowFormProps {
  flowId: string;
  onCancel: () => void;
}

export function ConnectFlowForm({ flowId, onCancel }: ConnectFlowFormProps) {
  const configureMutation = useConfigureSync(flowId);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [filePath, setFilePath] = useState('');
  const [mode, setMode] = useState<VcSyncMode>('direct-commit');
  const [syncDirection, setSyncDirection] = useState<VcSyncDirection>('write');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    configureMutation.mutate(
      {
        repo: repo || undefined,
        branch: branch || undefined,
        filePath: filePath || undefined,
        mode,
        syncDirection,
      },
      { onSuccess: onCancel },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-fl-muted-foreground" />
          <h3 className="text-sm font-medium">Connect to Git</h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-fl-muted-foreground hover:text-fl-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs text-fl-muted-foreground">
          Repository (optional — uses plugin default)
        </label>
        <input
          type="text"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/repo"
          className="w-full rounded-md border border-fl-border bg-fl-background px-2.5 py-1.5 text-sm placeholder:text-fl-muted-foreground focus:border-fl-primary focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-fl-muted-foreground">Branch</label>
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          className="w-full rounded-md border border-fl-border bg-fl-background px-2.5 py-1.5 text-sm placeholder:text-fl-muted-foreground focus:border-fl-primary focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-fl-muted-foreground">
          File path (optional — auto-generated from flow name)
        </label>
        <input
          type="text"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="workflows/my-flow.flow.ts"
          className="w-full rounded-md border border-fl-border bg-fl-background px-2.5 py-1.5 text-sm font-mono placeholder:text-fl-muted-foreground focus:border-fl-primary focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs text-fl-muted-foreground">Sync Mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as VcSyncMode)}
          className="w-full rounded-md border border-fl-border bg-fl-background px-2.5 py-1.5 text-sm focus:border-fl-primary focus:outline-none"
        >
          <option value="direct-commit">Direct Commit</option>
          <option value="pr-per-save">PR per Save</option>
          <option value="pr-per-publish">PR per Publish</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-fl-muted-foreground">Sync Direction</label>
        <select
          value={syncDirection}
          onChange={(e) => setSyncDirection(e.target.value as VcSyncDirection)}
          className="w-full rounded-md border border-fl-border bg-fl-background px-2.5 py-1.5 text-sm focus:border-fl-primary focus:outline-none"
        >
          <option value="write">Write (Flowlib → Git)</option>
          <option value="read">Read (Git → Flowlib)</option>
          <option value="read-write">Read / Write</option>
        </select>
      </div>

      {configureMutation.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600">
          {configureMutation.error.message}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={configureMutation.isPending}
          className="flex-1 rounded-md bg-fl-primary px-3 py-1.5 text-sm font-medium text-fl-primary-foreground hover:bg-fl-primary/90 disabled:opacity-50"
        >
          {configureMutation.isPending ? 'Connecting...' : 'Connect'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-fl-border px-3 py-1.5 text-sm font-medium hover:bg-fl-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
