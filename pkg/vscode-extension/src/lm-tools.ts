/**
 * VSCode Language Model Tools — exposed to GitHub Copilot's agent mode
 * and Cursor's chat. Each tool gets a stable id, an input JSON schema,
 * and an `invoke` handler that returns a `LanguageModelToolResult`.
 *
 * Tools are also declared in `package.json` under
 * `contributes.languageModelTools`, which is what makes them
 * discoverable to the LLM. The runtime registration here wires the
 * actual handler to the declared id.
 *
 * Tools currently exposed (all read-only-ish or sandboxed by the
 * embedded backend):
 *
 *   - `flowlib_list_flows`     — workspace `.flow.ts` files + their DB ids
 *   - `flowlib_get_flow`       — parse a file, return its definition
 *   - `flowlib_validate_flow`  — parse + report errors
 *   - `flowlib_run_flow`       — execute a flow, return run id + status
 *   - `flowlib_list_runs`      — recent runs for a flow
 *   - `flowlib_get_run`        — node executions for a single run
 *   - `flowlib_list_actions`   — every action available in the embedded backend
 */

import * as vscode from 'vscode';

import type { Backend } from './backend/Backend';
import { parseFlowFile } from './flow-file/parse';

export interface LmToolDeps {
  /** Active backend (always embedded for now — only it understands file URIs). */
  getBackend: () => Backend;
}

export function registerLanguageModelTools(deps: LmToolDeps): vscode.Disposable[] {
  // VSCode 1.95+ surfaces `vscode.lm.registerTool`. Older runtimes don't —
  // bail gracefully so the extension still activates.
  const lm = vscode.lm as { registerTool?: typeof vscode.lm.registerTool } | undefined;
  if (!lm?.registerTool) {
    return [];
  }
  const reg = lm.registerTool.bind(lm);
  return [
    reg('flowlib_list_flows', new ListFlowsTool(deps)),
    reg('flowlib_get_flow', new GetFlowTool(deps)),
    reg('flowlib_validate_flow', new ValidateFlowTool()),
    reg('flowlib_run_flow', new RunFlowTool(deps)),
    reg('flowlib_list_runs', new ListRunsTool(deps)),
    reg('flowlib_get_run', new GetRunTool(deps)),
    reg('flowlib_list_actions', new ListActionsTool(deps)),
  ];
}

// ── Helpers ─────────────────────────────────────────────────────────

function jsonResult(value: unknown): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify(value, null, 2)),
  ]);
}

function textResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

async function readFlow(
  fileUri: string,
): Promise<{ ok: true; flow: unknown } | { ok: false; error: string }> {
  try {
    const uri = vscode.Uri.parse(fileUri);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const src = new TextDecoder().decode(bytes);
    const parsed = await parseFlowFile(src, { trusted: vscode.workspace.isTrusted });
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    return { ok: true, flow: parsed.flow };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── Tool implementations ────────────────────────────────────────────

class ListFlowsTool implements vscode.LanguageModelTool<Record<string, never>> {
  constructor(private readonly deps: LmToolDeps) {}
  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: 'Listing Flowlib flows in workspace…' };
  }
  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const flows = await this.deps.getBackend().listFlows();
    return jsonResult(flows);
  }
}

interface FileUriInput {
  fileUri: string;
}

class GetFlowTool implements vscode.LanguageModelTool<FileUriInput> {
  constructor(private readonly deps: LmToolDeps) {
    void this.deps;
  }
  prepareInvocation(
    opts: vscode.LanguageModelToolInvocationPrepareOptions<FileUriInput>,
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Reading flow ${opts.input.fileUri}…` };
  }
  async invoke(
    opts: vscode.LanguageModelToolInvocationOptions<FileUriInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await readFlow(opts.input.fileUri);
    if (!result.ok) {
      return textResult(`Failed to read flow: ${result.error}`);
    }
    return jsonResult(result.flow);
  }
}

class ValidateFlowTool implements vscode.LanguageModelTool<FileUriInput> {
  prepareInvocation(
    opts: vscode.LanguageModelToolInvocationPrepareOptions<FileUriInput>,
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Validating ${opts.input.fileUri}…` };
  }
  async invoke(
    opts: vscode.LanguageModelToolInvocationOptions<FileUriInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await readFlow(opts.input.fileUri);
    if (!result.ok) {
      return jsonResult({ valid: false, error: result.error });
    }
    const flow = result.flow as { nodes?: unknown[]; edges?: unknown[] };
    return jsonResult({
      valid: true,
      nodeCount: flow.nodes?.length ?? 0,
      edgeCount: flow.edges?.length ?? 0,
    });
  }
}

interface RunFlowInput {
  fileUri: string;
  inputs?: Record<string, unknown>;
}

class RunFlowTool implements vscode.LanguageModelTool<RunFlowInput> {
  constructor(private readonly deps: LmToolDeps) {}
  prepareInvocation(
    opts: vscode.LanguageModelToolInvocationPrepareOptions<RunFlowInput>,
  ): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Running flow ${opts.input.fileUri}…`,
      // Running a flow can have side effects (HTTP requests, LLM calls,
      // emails, etc.) so we ask for explicit confirmation.
      confirmationMessages: {
        title: 'Run Flowlib flow?',
        message: new vscode.MarkdownString(
          `The assistant wants to execute \`${opts.input.fileUri}\` against the embedded backend. The flow may make external API calls.`,
        ),
      },
    };
  }
  async invoke(
    opts: vscode.LanguageModelToolInvocationOptions<RunFlowInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const inputs = opts.input.inputs ?? {};
    try {
      const r = await this.deps.getBackend().runFlow(opts.input.fileUri, inputs);
      return jsonResult({ flowRunId: r.flowRunId, flowId: r.flowId, status: r.status });
    } catch (err) {
      return textResult(`Run failed: ${(err as Error).message}`);
    }
  }
}

interface FlowIdInput {
  flowId: string;
}

class ListRunsTool implements vscode.LanguageModelTool<FlowIdInput> {
  constructor(private readonly deps: LmToolDeps) {}
  prepareInvocation(
    opts: vscode.LanguageModelToolInvocationPrepareOptions<FlowIdInput>,
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Listing runs for ${opts.input.flowId}…` };
  }
  async invoke(
    opts: vscode.LanguageModelToolInvocationOptions<FlowIdInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const runs = await this.deps.getBackend().listRuns(opts.input.flowId);
    return jsonResult(runs);
  }
}

interface RunIdInput {
  runId: string;
}

class GetRunTool implements vscode.LanguageModelTool<RunIdInput> {
  constructor(private readonly deps: LmToolDeps) {}
  prepareInvocation(
    opts: vscode.LanguageModelToolInvocationPrepareOptions<RunIdInput>,
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Reading run ${opts.input.runId}…` };
  }
  async invoke(
    opts: vscode.LanguageModelToolInvocationOptions<RunIdInput>,
  ): Promise<vscode.LanguageModelToolResult> {
    const nodes = await this.deps.getBackend().listNodeExecutions(opts.input.runId);
    return jsonResult({ runId: opts.input.runId, nodeExecutions: nodes });
  }
}

class ListActionsTool implements vscode.LanguageModelTool<Record<string, never>> {
  constructor(private readonly deps: LmToolDeps) {}
  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: 'Listing available Flowlib actions…' };
  }
  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const actions = await this.deps.getBackend().listActions();
    // Trim to id + name + description so the LLM doesn't drown in
    // schemas — it can ask for full details on a specific action by
    // looking up the registry directly via MCP.
    const trimmed = (actions as Array<Record<string, unknown>>).map((a) => ({
      id: a.id ?? a.type,
      name: a.name,
      description: a.description,
    }));
    return jsonResult(trimmed);
  }
}
