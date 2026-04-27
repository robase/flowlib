/**
 * DeployButton — Header action that compiles the current flow into a
 * Vercel Workflows source pair and shows it in a copy-paste modal.
 *
 * The button calls `GET /plugins/vercel-workflows/preview/:flowId`
 * which returns:
 *   - workflowSource: `'use workflow'` file the user drops into their Next.js app
 *   - sdkSource:      `@flowlib/sdk` flow definition the workflow imports
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, Rocket } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useApiBaseURL,
  type HeaderActionProps,
} from '@flowlib/ui';

interface PreviewSuccess {
  success: true;
  workflowSource: string;
  sdkSource: string;
  warnings?: string[];
  metadata?: {
    stepCount: number;
    outputCount: number;
    workflowName: string;
    flowExport: string;
    activeTriggerId?: string;
  };
}

interface TriggerInfo {
  id: string;
  type: string;
  referenceId?: string;
}

interface PreviewFailure {
  success: false;
  error: string;
  stage?: string;
  sdkSource?: string;
  /** Present when `stage === 'select-trigger'` — flow has multiple triggers. */
  triggers?: TriggerInfo[];
}

type PreviewResponse = PreviewSuccess | PreviewFailure;

export function DeployButton({ flowId }: HeaderActionProps) {
  if (!flowId) {
    return null;
  }
  return <DeployButtonInner flowId={flowId} />;
}

function DeployButtonInner({ flowId }: { flowId: string }) {
  const apiBaseUrl = useApiBaseURL();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PreviewResponse | null>(null);

  const fetchPreview = useCallback(
    async (triggerNodeId?: string) => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL(
          `${apiBaseUrl}/plugins/vercel-workflows/preview/${encodeURIComponent(flowId)}`,
          window.location.origin,
        );
        if (triggerNodeId) {
          url.searchParams.set('triggerNodeId', triggerNodeId);
        }
        // URL.toString() yields an absolute URL; strip the fake origin for same-origin fetches.
        const requestUrl = apiBaseUrl.startsWith('http')
          ? url.toString()
          : url.pathname + url.search;
        const res = await fetch(requestUrl, { credentials: 'include' });
        const json = (await res.json()) as PreviewResponse | { error: string };
        // The multi-trigger picker response is a 400 with stage: 'select-trigger'
        // and a `triggers` array — surface it as structured data rather than an error.
        if (!res.ok) {
          if (
            typeof json === 'object' &&
            json !== null &&
            'stage' in json &&
            (json as PreviewFailure).stage === 'select-trigger'
          ) {
            setData(json as PreviewResponse);
          } else {
            const message = 'error' in json ? json.error : `Request failed (${res.status})`;
            setError(message);
            setData(null);
          }
        } else {
          setData(json as PreviewResponse);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, flowId],
  );

  useEffect(() => {
    if (open) {
      void fetchPreview();
    }
  }, [open, fetchPreview]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
          title="Deploy to Vercel Workflows"
        >
          <Rocket className="h-4 w-4 text-muted-foreground" />
          <span>Deploy</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex flex-col p-0 overflow-hidden sm:max-w-4xl"
        style={{ height: '85vh', width: '1000px', maxWidth: '95vw' }}
      >
        <DialogHeader className="shrink-0 border-b px-6 py-5">
          <DialogTitle>Deploy to Vercel Workflows</DialogTitle>
          <DialogDescription>
            Copy these two files into your Next.js app to run this flow as a Vercel Workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Compiling…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">Failed to compile</p>
              <p className="mt-1 break-words">{error}</p>
            </div>
          )}

          {data && data.success === false && data.stage === 'select-trigger' && data.triggers && (
            <div className="rounded-lg border bg-muted/20 px-4 py-4 text-sm">
              <p className="font-medium">This flow has multiple triggers</p>
              <p className="mt-1 text-muted-foreground">
                A Vercel Workflow has a single entry point. Pick which trigger's subgraph to
                compile.
              </p>
              <div className="mt-3 space-y-1.5">
                {data.triggers.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      void fetchPreview(t.id);
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{t.referenceId ?? t.id}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{t.type}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">Compile →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data && data.success === false && data.stage !== 'select-trigger' && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">Compile failed{data.stage ? ` (${data.stage})` : ''}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{data.error}</p>
              {data.sdkSource && (
                <CodeBlock
                  title="flow.ts (SDK source — partial output)"
                  filename="flow.ts"
                  code={data.sdkSource}
                />
              )}
            </div>
          )}

          {data && data.success && (
            <>
              {data.metadata && (
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <Metric label="Steps" value={data.metadata.stepCount} />
                  <Metric label="Outputs" value={data.metadata.outputCount} />
                  <Metric label="Workflow" value={data.metadata.workflowName} mono />
                  <Metric label="Flow export" value={data.metadata.flowExport} mono />
                </div>
              )}

              {data.warnings && data.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <p className="font-medium">Warnings</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {data.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <CodeBlock
                title="workflow.ts"
                filename="workflow.ts"
                description="Drop into your Next.js app — uses the 'use workflow' directive."
                code={data.workflowSource}
              />
              <CodeBlock
                title="flow.ts"
                filename="flow.ts"
                description="@flowlib/sdk flow definition imported by workflow.ts."
                code={data.sdkSource}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CodeBlock({
  title,
  description,
  filename,
  code,
}: {
  title: string;
  description?: string;
  filename: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium hover:bg-accent"
          title={`Copy ${filename}`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={mono ? 'mt-0.5 truncate font-mono text-xs' : 'mt-0.5 text-sm font-medium'}>
        {value}
      </p>
    </div>
  );
}
