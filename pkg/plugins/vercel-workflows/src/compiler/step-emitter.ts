import type { ControlFlow } from './control-flow';
import type { PrimitiveFlowDefinition } from '@flowlib/primitives';
import { ifElseAction } from '@flowlib/primitives';

// Derive if_else handle IDs from the action definition (see control-flow.ts).
const IF_ELSE_TRUE_HANDLE = ifElseAction.outputs?.[0]?.id ?? 'true_output';

// Sanitize a referenceId for use as a TypeScript identifier.
// Non-[a-zA-Z0-9_] characters → '_'. Collisions are possible for weird refs;
// validate elsewhere that referenceIds remain unique post-sanitization.
export function sanitizeIdent(ref: string): string {
  const cleaned = ref.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned;
}

export interface EmitContext {
  flow: PrimitiveFlowDefinition;
  outputNodeSet: Set<string>;
  indent: string;
}

function indentMore(indent: string): string {
  return indent + '  ';
}

function quote(s: string): string {
  return JSON.stringify(s);
}

function emitStepCallAndCollect(nodeRef: string, ctx: EmitContext): string {
  const ident = sanitizeIdent(nodeRef);
  const { indent } = ctx;
  const lines: string[] = [];
  lines.push(
    `${indent}const r_${ident} = await step_${ident}({ inputs, completedOutputs, flowRunId });`,
  );
  lines.push(`${indent}if (!r_${ident}.success) {`);
  lines.push(
    `${indent}  throw new Error(\`Node ${quote(nodeRef).slice(1, -1)} failed: \${r_${ident}.error ?? 'unknown'}\`);`,
  );
  lines.push(`${indent}}`);
  lines.push(`${indent}completedOutputs[${quote(nodeRef)}] = extractPrimary(r_${ident});`);
  if (ctx.outputNodeSet.has(nodeRef)) {
    lines.push(
      `${indent}flowOutputs[(r_${ident}.metadata?.outputName as string | undefined) ?? ${quote(nodeRef)}] = extractPrimary(r_${ident});`,
    );
  }
  return lines.join('\n');
}

function emitBlock(block: ControlFlow, ctx: EmitContext): string {
  if (block.kind === 'step') {
    return emitStepCallAndCollect(block.nodeRef, ctx);
  }

  if (block.kind === 'ifElse') {
    const ident = sanitizeIdent(block.nodeRef);
    const nested: EmitContext = { ...ctx, indent: indentMore(ctx.indent) };
    const lines: string[] = [];
    lines.push(emitStepCallAndCollect(block.nodeRef, ctx));
    lines.push(
      `${ctx.indent}if (${quote(IF_ELSE_TRUE_HANDLE)} in (r_${ident}.outputVariables ?? {})) {`,
    );
    if (block.trueBlock.length === 0) {
      lines.push(`${nested.indent}// (empty true branch)`);
    } else {
      for (const inner of block.trueBlock) {
        lines.push(emitBlock(inner, nested));
      }
    }
    lines.push(`${ctx.indent}} else {`);
    if (block.falseBlock.length === 0) {
      lines.push(`${nested.indent}// (empty false branch)`);
    } else {
      for (const inner of block.falseBlock) {
        lines.push(emitBlock(inner, nested));
      }
    }
    lines.push(`${ctx.indent}}`);
    return lines.join('\n');
  }

  // switch, matchMode === 'first'
  const ident = sanitizeIdent(block.nodeRef);
  const nested: EmitContext = { ...ctx, indent: indentMore(ctx.indent) };
  const lines: string[] = [];
  lines.push(emitStepCallAndCollect(block.nodeRef, ctx));

  if (block.cases.length === 0) {
    // All-default switch: still emit the default block
    if (block.defaultBlock.length > 0) {
      for (const inner of block.defaultBlock) {
        lines.push(emitBlock(inner, ctx));
      }
    }
    return lines.join('\n');
  }

  block.cases.forEach((c, i) => {
    const keyword = i === 0 ? 'if' : '} else if';
    lines.push(
      `${ctx.indent}${keyword} (${quote(c.slug)} in (r_${ident}.outputVariables ?? {})) {`,
    );
    if (c.block.length === 0) {
      lines.push(`${nested.indent}// (empty ${c.slug} branch)`);
    } else {
      for (const inner of c.block) {
        lines.push(emitBlock(inner, nested));
      }
    }
  });

  lines.push(`${ctx.indent}} else {`);
  if (block.defaultBlock.length === 0) {
    lines.push(`${nested.indent}// (empty default branch)`);
  } else {
    for (const inner of block.defaultBlock) {
      lines.push(emitBlock(inner, nested));
    }
  }
  lines.push(`${ctx.indent}}`);
  return lines.join('\n');
}

export function emitOrchestratorBody(
  blocks: ControlFlow[],
  ctx: Omit<EmitContext, 'indent'>,
): string {
  const outCtx: EmitContext = { ...ctx, indent: '  ' };
  return blocks.map((b) => emitBlock(b, outCtx)).join('\n');
}

// Emit one "use step" function per node in the flow.
// Uses a stable topo order for deterministic output.
export function emitStepFunctions(nodeRefs: string[]): string {
  return nodeRefs
    .map((nodeRef) => {
      const ident = sanitizeIdent(nodeRef);
      return [
        `async function step_${ident}(args: {`,
        `  inputs: Record<string, unknown>;`,
        `  completedOutputs: Record<string, unknown>;`,
        `  flowRunId: string;`,
        `}): Promise<ActionResult> {`,
        `  'use step';`,
        `  return executeStep({`,
        `    flow,`,
        `    nodeRef: ${quote(nodeRef)},`,
        `    completedOutputs: args.completedOutputs,`,
        `    inputs: args.inputs,`,
        `    flowRunId: args.flowRunId,`,
        `    config: getFlowConfig(),`,
        `  });`,
        `}`,
      ].join('\n');
    })
    .join('\n\n');
}
