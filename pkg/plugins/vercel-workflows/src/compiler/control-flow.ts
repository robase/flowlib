import type { PrimitiveFlowDefinition, PrimitiveEdge, PrimitiveNode } from '@flowlib/primitives';
import {
  ifElseAction,
  topologicalSort,
  IF_ELSE_TYPES,
  SWITCH_TYPES,
  OUTPUT_TYPES,
  edgeSource,
  edgeTarget,
  edgeHandle,
} from '@flowlib/primitives';

// ─── Types ────────────────────────────────────────────────────────────────────

export const BRANCH_TYPES = {
  ifElse: IF_ELSE_TYPES,
  switch: SWITCH_TYPES,
} as const;

export { OUTPUT_TYPES };

// Slug used for the switch "no case matched" branch — re-exported so the emitter
// stays in lockstep with the analyzer.
export const SWITCH_DEFAULT_SLUG = 'default';

export type ControlFlow =
  | { kind: 'step'; nodeRef: string }
  | {
      kind: 'ifElse';
      nodeRef: string;
      trueBlock: ControlFlow[];
      falseBlock: ControlFlow[];
    }
  | {
      kind: 'switch';
      nodeRef: string;
      matchMode: 'first';
      cases: { slug: string; block: ControlFlow[] }[];
      defaultBlock: ControlFlow[];
    };

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

// ─── Graph helpers ────────────────────────────────────────────────────────────

function descendantsOf(start: string, adj: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const stack = [start];
  let n = stack.pop();
  while (n !== undefined) {
    if (!visited.has(n)) {
      visited.add(n);
      for (const next of adj.get(n) ?? []) {
        stack.push(next);
      }
    }
    n = stack.pop();
  }
  return visited;
}

function ancestorsOf(target: string, reverseAdj: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const stack = [target];
  let n = stack.pop();
  while (n !== undefined) {
    if (!visited.has(n)) {
      visited.add(n);
      for (const prev of reverseAdj.get(n) ?? []) {
        stack.push(prev);
      }
    }
    n = stack.pop();
  }
  return visited;
}

function buildAdjacency(edges: PrimitiveEdge[]): {
  adj: Map<string, string[]>;
  reverseAdj: Map<string, string[]>;
} {
  const adj = new Map<string, string[]>();
  const reverseAdj = new Map<string, string[]>();
  for (const edge of edges) {
    const from = edgeSource(edge);
    const to = edgeTarget(edge);
    let fromList = adj.get(from);
    if (!fromList) {
      fromList = [];
      adj.set(from, fromList);
    }
    fromList.push(to);

    let toList = reverseAdj.get(to);
    if (!toList) {
      toList = [];
      reverseAdj.set(to, toList);
    }
    toList.push(from);
  }
  return { adj, reverseAdj };
}

// ─── Convergence detection ───────────────────────────────────────────────────

function findConvergence(
  armStarts: (string | null)[],
  adj: Map<string, string[]>,
  topoIndex: Map<string, number>,
): string | null {
  const reachabilities = armStarts
    .filter((s): s is string => s !== null)
    .map((s) => descendantsOf(s, adj));

  if (reachabilities.length === 0) {
    return null;
  }

  // Intersection in topological order — pick the earliest node reachable from all arms
  const [firstReach, ...restReach] = reachabilities;
  if (!firstReach) {
    return null;
  }
  let candidates = Array.from(firstReach);
  for (const r of restReach) {
    candidates = candidates.filter((c) => r.has(c));
  }
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0));
  return candidates[0] ?? null;
}

// Returns the set of nodes belonging to an arm that starts at `start` and
// terminates before `converge` (if non-null). When `converge` is null the arm
// contains every descendant of `start`.
function armMembership(
  start: string | null,
  converge: string | null,
  adj: Map<string, string[]>,
  reverseAdj: Map<string, string[]>,
): Set<string> {
  if (!start) {
    return new Set();
  }
  const descendants = descendantsOf(start, adj);
  if (converge === null) {
    return descendants;
  }
  const ancestorsOfConverge = ancestorsOf(converge, reverseAdj);
  const out = new Set<string>();
  for (const n of descendants) {
    if (n === converge) {
      continue;
    }
    if (ancestorsOfConverge.has(n)) {
      out.add(n);
    }
  }
  // Handle the case where `start` has no path to `converge` (terminal arm):
  // keep the pure descendants (minus converge itself).
  if (out.size === 0) {
    for (const n of descendants) {
      if (n !== converge) {
        out.add(n);
      }
    }
  }
  return out;
}

// ─── Branch arm extraction ───────────────────────────────────────────────────

function armStartFor(nodeRef: string, handle: string, edges: PrimitiveEdge[]): string | null {
  const match = edges.find((e) => edgeSource(e) === nodeRef && edgeHandle(e) === handle);
  return match ? edgeTarget(match) : null;
}

function extractSwitchCases(node: PrimitiveNode): {
  matchMode: 'first' | 'all';
  slugs: string[];
} {
  const params = node.params ?? {};
  const casesRaw = (params as { cases?: unknown }).cases;
  const matchModeRaw = (params as { matchMode?: unknown }).matchMode;

  if (typeof casesRaw === 'function') {
    throw new CompileError(
      `Switch node "${node.referenceId}": cases must be a static array for compilation. ` +
        `Callable cases are only supported by the in-memory runner.`,
    );
  }
  if (!Array.isArray(casesRaw)) {
    throw new CompileError(`Switch node "${node.referenceId}": missing or invalid "cases" param`);
  }
  const slugs: string[] = [];
  for (const c of casesRaw) {
    const slug = (c as { slug?: unknown }).slug;
    if (typeof slug !== 'string' || slug.length === 0) {
      throw new CompileError(
        `Switch node "${node.referenceId}": every case must have a non-empty string "slug"`,
      );
    }
    slugs.push(slug);
  }
  const matchMode = matchModeRaw === 'all' ? 'all' : 'first';
  return { matchMode, slugs };
}

// ─── Main analyzer ────────────────────────────────────────────────────────────

export interface AnalyzedFlow {
  blocks: ControlFlow[];
  outputNodes: string[]; // referenceIds of core.output / primitives.output nodes
  topoOrder: string[];
}

export function analyzeFlow(flow: PrimitiveFlowDefinition): AnalyzedFlow {
  const topoOrder = topologicalSort(flow.nodes, flow.edges);
  const topoIndex = new Map(topoOrder.map((id, i) => [id, i]));
  const nodesById = new Map(flow.nodes.map((n) => [n.referenceId, n]));
  const { adj, reverseAdj } = buildAdjacency(flow.edges);

  // Derive if/else handle IDs from the action definition, so a rename of
  // `true_output` / `false_output` only needs to happen in one place.
  const ifElseOutputs = ifElseAction.outputs ?? [];
  const [firstOut, secondOut] = ifElseOutputs;
  if (ifElseOutputs.length !== 2 || !firstOut || !secondOut) {
    throw new CompileError(
      `primitives.if_else must declare exactly 2 output handles (found ${ifElseOutputs.length}).`,
    );
  }
  const trueHandle = firstOut.id;
  const falseHandle = secondOut.id;

  const placed = new Set<string>();

  const compileNodeInto = (nodeRef: string, out: ControlFlow[]): void => {
    if (placed.has(nodeRef)) {
      return;
    }
    placed.add(nodeRef);

    const node = nodesById.get(nodeRef);
    if (!node) {
      throw new CompileError(`Unknown node referenceId: "${nodeRef}"`);
    }

    if (BRANCH_TYPES.ifElse.has(node.type)) {
      const trueStart = armStartFor(nodeRef, trueHandle, flow.edges);
      const falseStart = armStartFor(nodeRef, falseHandle, flow.edges);
      const outgoingWithoutHandle = flow.edges.filter(
        (e) => edgeSource(e) === nodeRef && edgeHandle(e) === undefined,
      );
      if (outgoingWithoutHandle.length > 0) {
        throw new CompileError(
          `If/else node "${nodeRef}" has edges without a sourceHandle; ` +
            `expected "${trueHandle}" or "${falseHandle}" on every outgoing edge`,
        );
      }

      const converge = findConvergence([trueStart, falseStart], adj, topoIndex);
      const trueSet = armMembership(trueStart, converge, adj, reverseAdj);
      const falseSet = armMembership(falseStart, converge, adj, reverseAdj);

      const trueBlock = compileArm(trueSet);
      const falseBlock = compileArm(falseSet);

      out.push({ kind: 'ifElse', nodeRef, trueBlock, falseBlock });
      return;
    }

    if (BRANCH_TYPES.switch.has(node.type)) {
      const { matchMode, slugs } = extractSwitchCases(node);
      if (matchMode === 'all') {
        throw new CompileError(
          `Switch node "${nodeRef}": matchMode="all" is not supported by the compiler. ` +
            `Use multiple if_else nodes, or matchMode="first". ` +
            `(All-match with shared downstream nodes cannot be expressed as TypeScript control flow.)`,
        );
      }

      const armStarts = slugs.map((slug) => armStartFor(nodeRef, slug, flow.edges));
      const defaultStart = armStartFor(nodeRef, SWITCH_DEFAULT_SLUG, flow.edges);

      const converge = findConvergence([...armStarts, defaultStart], adj, topoIndex);
      const caseBlocks = slugs.map((slug, i) => {
        const startNode = armStarts[i] ?? null;
        const armSet = armMembership(startNode, converge, adj, reverseAdj);
        return { slug, block: compileArm(armSet) };
      });
      const defaultSet = armMembership(defaultStart, converge, adj, reverseAdj);
      const defaultBlock = compileArm(defaultSet);

      out.push({
        kind: 'switch',
        nodeRef,
        matchMode: 'first',
        cases: caseBlocks,
        defaultBlock,
      });
      return;
    }

    // Linear / non-branching node: validate no unexpected fan-out.
    const outgoing = flow.edges.filter((e) => edgeSource(e) === nodeRef);
    if (outgoing.length > 1) {
      throw new CompileError(
        `Node "${nodeRef}" (type "${node.type}") has ${outgoing.length} outgoing edges. ` +
          `Fan-out is only supported from if_else or switch nodes. ` +
          `If this flow intends parallel downstream branches, introduce a branching node.`,
      );
    }
    out.push({ kind: 'step', nodeRef });
  };

  const compileArm = (armSet: Set<string>): ControlFlow[] => {
    const arm: ControlFlow[] = [];
    for (const ref of topoOrder) {
      if (!armSet.has(ref)) {
        continue;
      }
      if (placed.has(ref)) {
        continue;
      }
      compileNodeInto(ref, arm);
    }
    return arm;
  };

  const blocks: ControlFlow[] = [];
  for (const ref of topoOrder) {
    if (placed.has(ref)) {
      continue;
    }
    compileNodeInto(ref, blocks);
  }

  const outputNodes = flow.nodes.filter((n) => OUTPUT_TYPES.has(n.type)).map((n) => n.referenceId);

  return { blocks, outputNodes, topoOrder };
}
