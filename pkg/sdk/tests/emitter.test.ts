import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { emitSdkSource, SdkEmitError } from '../src/emitter';
import type { DbFlowDefinition } from '../src/emitter';

/** Confirm the emitter output parses as valid TypeScript (no syntax errors). */
function assertParses(source: string): void {
  const sourceFile = ts.createSourceFile(
    '__emit__.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  type WithDiag = ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
  const diags = (sourceFile as WithDiag).parseDiagnostics ?? [];
  if (diags.length > 0) {
    const msgs = diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
    throw new Error(`Emitted source failed to parse:\n${msgs}\n\nSource:\n${source}`);
  }
}

describe('emitSdkSource', () => {
  describe('basic structure', () => {
    it('emits a valid TS module for a minimal flow', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'query', params: {} },
          {
            id: 'n2',
            type: 'core.output',
            referenceId: 'out',
            params: { outputValue: '{{ query }}' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code, sdkImports } = emitSdkSource(def, { flowName: 'myFlow' });
      assertParses(code);
      expect(code).toContain(`import { defineFlow, output, trigger } from "@flowlib/sdk"`);
      expect(code).toContain(`export const myFlow = defineFlow({`);
      expect(code).toContain(`query: trigger.manual(),`);
      expect(code).toContain(`out: output({`);
      expect(code).toContain(`{ from: "query", to: "out" }`);
      expect(sdkImports.sort()).toEqual(['defineFlow', 'output', 'trigger'].sort());
    });

    it('rejects invalid flowName', () => {
      const def: DbFlowDefinition = { nodes: [], edges: [] };
      expect(() => emitSdkSource(def, { flowName: 'bad name' })).toThrow(SdkEmitError);
    });

    it('preserves metadata', () => {
      const def: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'q', params: {} }],
        edges: [],
        metadata: { name: 'My Flow', description: 'hi', tags: ['a'] },
      };
      const { code } = emitSdkSource(def);
      expect(code).toContain(`name: "My Flow"`);
      expect(code).toContain(`description: "hi"`);
      expect(code).toContain(`tags: ["a"]`);
    });
  });

  describe('code / ifElse / switch expressions', () => {
    it('code() emits an arrow with upstream destructured', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'user', params: {} },
          {
            id: 'n2',
            type: 'core.javascript',
            referenceId: 'greet',
            params: { code: '`Hi ${user.name}`' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`greet: code({ code:`);
      expect(code).toContain(`const { user } = ctx;`);
      // needsAutoReturn wraps expressions in return()
      expect(code).toContain(`return (\`Hi \${user.name}\`);`);
    });

    it('ifElse emits condition as arrow', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'x', params: {} },
          { id: 'n2', type: 'core.if_else', referenceId: 'check', params: { expression: 'x > 5' } },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`check: ifElse({ condition:`);
      expect(code).toContain(`const { x } = ctx;`);
      expect(code).toContain(`return (x > 5);`);
    });

    it('switch emits cases with arrow conditions', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'kind', params: {} },
          {
            id: 'n2',
            type: 'core.switch',
            referenceId: 'route',
            params: {
              matchMode: 'first',
              cases: [
                { slug: 'a', label: 'A', expression: 'kind === "a"' },
                { slug: 'b', label: 'B', expression: 'kind === "b"' },
              ],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`route: switchNode({`);
      expect(code).toContain(`matchMode: "first"`);
      expect(code).toContain(`slug: "a", label: "A", expression:`);
      expect(code).toContain(`return (kind === "a");`);
    });

    it('previous_nodes is destructured when an expression references it', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'direct', params: {} },
          {
            id: 'n2',
            type: 'core.javascript',
            referenceId: 'uses_indirect',
            params: { code: 'return previous_nodes.older.value + direct' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`const { direct, previous_nodes } = ctx;`);
    });
  });

  describe('output value rendering', () => {
    it('pure `{{ expr }}` → arrow with return(expr)', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'metrics', params: {} },
          {
            id: 'n2',
            type: 'core.output',
            referenceId: 'out',
            params: { outputValue: '{{ metrics }}' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`const { metrics } = ctx;`);
      expect(code).toContain(`return (metrics);`);
      expect(code).not.toContain('{{');
    });

    it('mixed text + {{ expr }} → template literal', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'user', params: {} },
          {
            id: 'n2',
            type: 'core.output',
            referenceId: 'greeting',
            params: { outputValue: 'Hi {{ user.name }} — welcome!' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain('Hi ${(user.name)} — welcome!');
    });

    it('plain string → string literal arrow', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.output',
            referenceId: 'out',
            params: { outputValue: 'hello world' },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`(ctx) => ("hello world")`);
    });
  });

  describe('agent + tool round-trip', () => {
    it('serializes addedTools via tool() calls and strips instanceId + _aiChosenModes', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.agent',
            referenceId: 'researcher',
            params: {
              credentialId: 'cred_abc',
              model: 'gpt-4o',
              taskPrompt: 'Find stuff',
              temperature: 0.2,
              addedTools: [
                {
                  instanceId: 'tool_xyz',
                  toolId: 'github.search_issues',
                  name: 'Find Issues',
                  description: 'Look for existing issues',
                  params: { perPage: 10, _aiChosenModes: { query: true } },
                },
              ],
            },
          },
        ],
        edges: [],
      };
      const { code, sdkImports } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`researcher: agent({`);
      expect(code).toContain(`credentialId: "cred_abc"`);
      expect(code).toContain(`addedTools: [`);
      expect(code).toContain(`tool("github.search_issues"`);
      expect(code).toContain(`name: "Find Issues"`);
      expect(code).toContain(`perPage: 10`);
      expect(code).not.toContain('_aiChosenModes');
      expect(code).not.toContain('tool_xyz');
      expect(sdkImports).toContain('tool');
      expect(sdkImports).toContain('agent');
    });

    it('minimal tool() without options', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.agent',
            referenceId: 'a',
            params: {
              credentialId: 'c',
              model: 'm',
              taskPrompt: 'p',
              addedTools: [{ instanceId: 'x', toolId: 'gmail.send_message', params: {} }],
            },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`tool("gmail.send_message")`);
    });

    it('emits DB-only agent fields outside the ordered SDK fields', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.agent',
            referenceId: 'a',
            params: {
              credentialId: 'c',
              model: 'm',
              taskPrompt: 'p',
              stopCondition: 'tool_result',
              toolTimeoutMs: 10000,
            },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      expect(code).toContain(`stopCondition: "tool_result"`);
      expect(code).toContain(`toolTimeoutMs: 10000`);
    });
  });

  describe('triggers', () => {
    it('trigger.manual with no inputs → trigger.manual("ref")', () => {
      const def: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'start', params: {} }],
        edges: [],
      };
      const { code, sdkImports } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`start: trigger.manual()`);
      expect(sdkImports).toContain('trigger');
    });

    it('trigger.manual with declared inputs → emits structured inputs literal', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'trigger.manual',
            referenceId: 'start',
            params: {
              inputs: [
                { name: 'foo', type: 'string', defaultValue: 'bar' },
                { name: 'count', type: 'number', defaultValue: 5 },
              ],
            },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`start: trigger.manual({ inputs:`);
      expect(code).toContain(`as const`);
      expect(code).toContain(`name: "foo"`);
      expect(code).toContain(`name: "count"`);
    });

    it('trigger.cron emits expression + timezone', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'trigger.cron',
            referenceId: 'sched',
            params: { expression: '0 9 * * 1-5', timezone: 'America/New_York' },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`sched: trigger.cron({`);
      expect(code).toContain(`expression: "0 9 * * 1-5"`);
      expect(code).toContain(`timezone: "America/New_York"`);
    });
  });

  describe('mapper emission', () => {
    it('enabled mapper → emitted as NodeOptions.mapper', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.javascript',
            referenceId: 'transform',
            params: { code: 'return ctx.x' },
            mapper: {
              enabled: true,
              expression: 'users',
              mode: 'iterate',
              outputMode: 'array',
              concurrency: 5,
              onEmpty: 'skip',
            },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`mapper:`);
      expect(code).toContain(`expression: "users"`);
      expect(code).toContain(`mode: "iterate"`);
      expect(code).toContain(`concurrency: 5`);
    });

    it('disabled mapper → omitted', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'core.javascript',
            referenceId: 'transform',
            params: { code: 'return 1' },
            mapper: { enabled: false, expression: '' },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      expect(code).not.toContain('mapper');
    });
  });

  describe('position preservation', () => {
    it('emits position as NodeOptions', () => {
      const def: DbFlowDefinition = {
        nodes: [
          {
            id: 'n1',
            type: 'trigger.manual',
            referenceId: 'q',
            params: {},
            position: { x: 100, y: 200 },
          },
        ],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`position:`);
      expect(code).toMatch(/x:\s*100/);
      expect(code).toMatch(/y:\s*200/);
    });
  });

  describe('provider action import emission', () => {
    it('unknown provider action → direct action-callable import', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'trigger.manual', referenceId: 'x', params: {} },
          {
            id: 'n2',
            type: 'gmail.send_message',
            referenceId: 'notify',
            params: { credentialId: 'c', to: 'x@y.z', subject: 'Hi', body: 'Hello' },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const { code, actionImports } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`import { gmailSendMessageAction } from "@flowlib/actions/gmail"`);
      expect(code).toContain(`notify: gmailSendMessageAction({`);
      expect(actionImports['@flowlib/actions/gmail']).toEqual(['gmailSendMessageAction']);
    });

    it('types with no dot → generic node() fallback', () => {
      const def: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'weirdtype', referenceId: 'x', params: { foo: 'bar' } }],
        edges: [],
      };
      const { code, sdkImports } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`x: node("weirdtype"`);
      expect(code).toContain(`foo: "bar"`);
      expect(sdkImports).toContain('node');
    });
  });

  describe('JSON footer', () => {
    it('emits /* @flowlib-definition */ footer when includeJsonFooter is true', () => {
      const def: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'q', params: {} }],
        edges: [],
        metadata: { name: 'test' },
      };
      const { code } = emitSdkSource(def, { includeJsonFooter: true });
      assertParses(code);
      expect(code).toContain('/* @flowlib-definition');
      expect(code).toContain('*/');
      // Footer contains the full definition as JSON.
      const footerMatch = code.match(/\/\* @flowlib-definition\n([\s\S]*?)\n\*\//);
      expect(footerMatch).not.toBeNull();
      if (footerMatch) {
        const parsed = JSON.parse(footerMatch[1]);
        expect(parsed.nodes).toHaveLength(1);
        expect(parsed.nodes[0].referenceId).toBe('q');
      }
    });

    it('no footer by default', () => {
      const def: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'q', params: {} }],
        edges: [],
      };
      const { code } = emitSdkSource(def);
      expect(code).not.toContain('@flowlib-definition');
    });
  });

  describe('edge handles', () => {
    it('preserves sourceHandle (if_else true/false branches)', () => {
      const def: DbFlowDefinition = {
        nodes: [
          { id: 'n1', type: 'core.if_else', referenceId: 'check', params: { expression: 'true' } },
          { id: 'n2', type: 'core.output', referenceId: 'yes', params: {} },
          { id: 'n3', type: 'core.output', referenceId: 'no', params: {} },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'true_output' },
          { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'false_output' },
        ],
      };
      const { code } = emitSdkSource(def);
      assertParses(code);
      expect(code).toContain(`{ from: "check", to: "yes", handle: "true_output" }`);
      expect(code).toContain(`{ from: "check", to: "no", handle: "false_output" }`);
    });
  });

  describe('error cases', () => {
    it('throws for code node missing params.code', () => {
      const def: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'core.javascript', referenceId: 'x', params: {} }],
        edges: [],
      };
      expect(() => emitSdkSource(def)).toThrow(SdkEmitError);
    });

    it('throws for edge referencing nonexistent node', () => {
      const def: DbFlowDefinition = {
        nodes: [{ id: 'n1', type: 'trigger.manual', referenceId: 'x', params: {} }],
        edges: [{ id: 'e1', source: 'n1', target: 'nonexistent' }],
      };
      expect(() => emitSdkSource(def)).toThrow(/unknown node/);
    });
  });
});
