import { describe, it, expect } from 'vitest';
import { transformArrowsToStrings } from '../src/transform';
import type { SdkFlowNode } from '../src/types';

// Helpers to build test nodes with function-valued params succinctly.
function codeNode(ref: string, code: unknown): SdkFlowNode {
  return { referenceId: ref, type: 'core.javascript', params: { code } };
}
function ifElseNode(ref: string, condition: unknown): SdkFlowNode {
  return { referenceId: ref, type: 'primitives.if_else', params: { condition } };
}
function switchNode(ref: string, cases: unknown[]): SdkFlowNode {
  return { referenceId: ref, type: 'core.switch', params: { cases } };
}

describe('transformArrowsToStrings', () => {
  describe('code nodes', () => {
    it('converts a concise arrow expression with ctx access', () => {
      const node = codeNode('t', (ctx: { x: number }) => ctx.x * 2);
      const { nodes, ok, diagnostics } = transformArrowsToStrings([node]);
      expect(diagnostics).toEqual([]);
      expect(ok).toBe(true);
      expect(nodes[0].params.code).toBe('x * 2');
    });

    it('converts a block body arrow', () => {
      const node = codeNode('t', (ctx: { items: number[] }) => {
        const total = ctx.items.reduce((a, b) => a + b, 0);
        return total;
      });
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].params.code).toContain('const total');
      expect(nodes[0].params.code).toContain('return total');
    });

    it('converts an arrow with destructured ctx', () => {
      const node = codeNode('t', ({ x, y }: { x: number; y: number }) => x + y);
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      // Destructuring → prelude + return(expr).
      expect(nodes[0].params.code).toContain('const { x, y } = ctx;');
      expect(nodes[0].params.code).toContain('return (x + y);');
    });

    it('passes through string code unchanged', () => {
      const node = codeNode('t', 'return ctx.x');
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].params.code).toBe('return ctx.x');
    });

    it('rejects async arrows', () => {
      const node = codeNode('t', async (ctx: { x: number }) => ctx.x);
      const { ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(false);
      expect(diagnostics.find((d) => d.code === 'async-arrow')).toBeDefined();
    });

    it('rejects arrows with await', () => {
      // Can't use a plain `await` without making the fn async — but we can
      // write an async/await combo to exercise both paths.
      const node = codeNode('t', async (ctx: { p: Promise<number> }) => await ctx.p);
      const { ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(false);
      expect(diagnostics.find((d) => d.code === 'async-arrow')).toBeDefined();
    });

    it('rejects for loops', () => {
      const node = codeNode('t', (ctx: { items: number[] }) => {
        let total = 0;
        for (const x of ctx.items) {
          total += x;
        }
        return total;
      });
      const { ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(false);
      expect(diagnostics.find((d) => d.code === 'loop')).toBeDefined();
    });

    it('rejects try/catch', () => {
      const node = codeNode('t', (ctx: { x: number }) => {
        try {
          return ctx.x;
        } catch {
          return 0;
        }
      });
      const { ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(false);
      expect(diagnostics.find((d) => d.code === 'try-catch')).toBeDefined();
    });

    it('rejects closure over outer variable', () => {
      const THRESHOLD = 10;
      const node = codeNode('t', (ctx: { x: number }) => ctx.x > THRESHOLD);
      const { ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(false);
      const err = diagnostics.find((d) => d.code === 'unknown-identifier');
      expect(err).toBeDefined();
      expect(err?.message).toContain('THRESHOLD');
    });

    it('allows standard-library identifiers (Math, JSON, Array)', () => {
      const node = codeNode('t', (ctx: { x: number; json: string }) => {
        const rounded = Math.round(ctx.x);
        const parsed = JSON.parse(ctx.json);
        const isArr = Array.isArray(parsed);
        return { rounded, isArr };
      });
      const { ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(diagnostics).toEqual([]);
    });

    it('allows additional globals via options', () => {
      const node = codeNode('t', (ctx: { x: number }) => {
        // @ts-expect-error — allowed via custom allowlist
        return customHelper(ctx.x);
      });
      const { ok } = transformArrowsToStrings([node], { allowedGlobals: ['customHelper'] });
      expect(ok).toBe(true);
    });

    it('allows identifiers declared inside the body', () => {
      const node = codeNode('t', (ctx: { items: number[] }) => {
        const doubled = ctx.items.map((n) => n * 2);
        return doubled;
      });
      const { ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
    });
  });

  describe('ifElse nodes', () => {
    it('converts primitives.if_else condition arrow', () => {
      const node = ifElseNode('check', (ctx: { age: number }) => ctx.age >= 18);
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].params.condition).toBe('age >= 18');
    });

    it('core.if_else with string expression passes through', () => {
      const node: SdkFlowNode = {
        referenceId: 'check',
        type: 'core.if_else',
        params: { expression: 'x > 5' },
      };
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].params.expression).toBe('x > 5');
    });
  });

  describe('switch nodes', () => {
    it('converts case conditions from functions to expressions', () => {
      const node = switchNode('route', [
        {
          slug: 'a',
          label: 'A',
          condition: (ctx: { kind: string }) => ctx.kind === 'a',
        },
        {
          slug: 'b',
          label: 'B',
          condition: (ctx: { kind: string }) => ctx.kind === 'b',
        },
      ]);
      const { nodes, ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(diagnostics).toEqual([]);
      const cases = nodes[0].params.cases as Array<{ expression: string; slug: string }>;
      expect(cases[0].expression).toBe('kind === "a"');
      expect(cases[1].expression).toBe('kind === "b"');
    });

    it('switch cases with string expressions pass through (renamed from condition)', () => {
      const node = switchNode('route', [{ slug: 'a', label: 'A', condition: 'kind === "a"' }]);
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      const cases = nodes[0].params.cases as Array<{ expression: string }>;
      expect(cases[0].expression).toBe('kind === "a"');
    });

    it('reports precise diagnostic path for failing case', () => {
      const CLOSURE = 5;
      const node = switchNode('route', [
        { slug: 'a', label: 'A', condition: (ctx: { x: number }) => ctx.x === CLOSURE },
      ]);
      const { ok, diagnostics } = transformArrowsToStrings([node]);
      expect(ok).toBe(false);
      const d = diagnostics.find((x) => x.code === 'unknown-identifier');
      expect(d?.path).toBe('cases[0].condition');
      expect(d?.nodeRef).toBe('route');
    });
  });

  describe('output node value (primitives.output)', () => {
    it('converts a template-literal arrow back to a `{{ expr }}` DB string', () => {
      // The emitter renders mixed-text output values as template literals
      // `(ctx) => \`Result: ${ctx.result}\``. The transform must invert that
      // back to the DB's template-string form `Result: {{ result }}` so the
      // emit → eval → transform cycle is idempotent.
      const node: SdkFlowNode = {
        referenceId: 'out',
        type: 'primitives.output',
        params: { outputValue: (ctx: { result: string }) => `Result: ${ctx.result}` },
      };
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].params.outputValue).toBe('Result: {{ result }}');
    });

    it('converts a bare-string arrow to a plain DB string', () => {
      const node: SdkFlowNode = {
        referenceId: 'out',
        type: 'primitives.output',
        params: { outputValue: () => 'hello world' },
      };
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].params.outputValue).toBe('hello world');
    });

    it('converts a pure expression arrow to a `{{ expr }}` DB string', () => {
      const node: SdkFlowNode = {
        referenceId: 'out',
        type: 'primitives.output',
        params: { outputValue: (ctx: { count: number }) => ctx.count },
      };
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].params.outputValue).toBe('{{ count }}');
    });
  });

  describe('mapper transform', () => {
    it('converts a function-valued mapper on a code node', () => {
      const node: SdkFlowNode = {
        referenceId: 't',
        type: 'core.javascript',
        params: { code: 'return item' },
        mapper: (ctx: { items: unknown[] }) => ctx.items as never,
      };
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      const mapper = nodes[0].mapper as Record<string, unknown>;
      expect(mapper.enabled).toBe(true);
      expect(mapper.expression).toBe('items');
    });

    it('converts an object-mapper with a function expression field', () => {
      const node: SdkFlowNode = {
        referenceId: 't',
        type: 'core.javascript',
        params: { code: 'return 1' },
        mapper: {
          enabled: true,
          expression: (ctx: { items: unknown[] }) => ctx.items,
          mode: 'iterate',
          outputMode: 'array',
          concurrency: 1,
          onEmpty: 'skip',
        },
      };
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      const mapper = nodes[0].mapper as Record<string, unknown>;
      expect(mapper.expression).toBe('items');
      expect(mapper.mode).toBe('iterate');
    });

    it('leaves string-mapper expressions untouched', () => {
      const originalMapper = {
        enabled: true,
        expression: 'users',
        mode: 'iterate',
        outputMode: 'array',
        concurrency: 1,
        onEmpty: 'skip',
      };
      const node: SdkFlowNode = {
        referenceId: 't',
        type: 'core.javascript',
        params: { code: 'return 1' },
        mapper: originalMapper,
      };
      const { nodes, ok } = transformArrowsToStrings([node]);
      expect(ok).toBe(true);
      expect(nodes[0].mapper).toEqual(originalMapper);
    });
  });

  describe('multi-node flows', () => {
    it('accumulates diagnostics across nodes without short-circuiting', () => {
      const nodes: SdkFlowNode[] = [
        codeNode('good', (ctx: { x: number }) => ctx.x * 2),
        codeNode('bad1', (ctx: { x: number }) => {
          for (const y of [ctx.x]) {
            return y;
          }
        }),
        codeNode('bad2', async (ctx: { x: number }) => ctx.x),
      ];
      const { ok, diagnostics } = transformArrowsToStrings(nodes);
      expect(ok).toBe(false);
      expect(diagnostics.filter((d) => d.level === 'error')).toHaveLength(2);
      expect(diagnostics.find((d) => d.nodeRef === 'bad1' && d.code === 'loop')).toBeDefined();
      expect(
        diagnostics.find((d) => d.nodeRef === 'bad2' && d.code === 'async-arrow'),
      ).toBeDefined();
    });

    it('does not mutate input nodes', () => {
      const original = codeNode('t', (ctx: { x: number }) => ctx.x);
      const originalFn = original.params.code;
      const { nodes } = transformArrowsToStrings([original]);
      expect(original.params.code).toBe(originalFn);
      expect(nodes[0]).not.toBe(original);
    });

    it('passes through nodes without function params unchanged', () => {
      const input: SdkFlowNode = {
        referenceId: 'q',
        type: 'trigger.manual',
        params: { variableName: 'query' },
      };
      const { nodes, ok } = transformArrowsToStrings([input]);
      expect(ok).toBe(true);
      expect(nodes[0]).toBe(input);
    });
  });
});
