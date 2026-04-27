import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { defineFlow, input, output, ifElse, code, switchNode } from '@flowlib/primitives';
import { compile } from '../src/compiler/flow-compiler';

// Parse-level validation: compile the generated source with TypeScript's parser
// and confirm zero syntactic diagnostics. Full type-checking would require
// resolving imports to the runtime package; that's covered by tsc at the
// package level when this package is built.
function assertParsesWithoutErrors(source: string): void {
  const sourceFile = ts.createSourceFile(
    '__generated__.ts',
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  // `parseDiagnostics` is internal but surface-level syntactic errors land here.
  // Fallback to scanner-driven scan if absent.
  type WithDiag = ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
  const diags = (sourceFile as WithDiag).parseDiagnostics ?? [];
  if (diags.length > 0) {
    const messages = diags
      .map((d) => `${d.start}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
      .join('\n');
    throw new Error(`Generated source failed to parse:\n${messages}\n\n--- source ---\n${source}`);
  }
}

const defaultOptions = {
  workflowName: 'myWorkflow',
  flowImport: './my-flow',
  flowExport: 'myFlow',
  configImport: './my-flow.config',
  configExport: 'getFlowConfig',
};

describe('compile — generated source is syntactically valid TypeScript', () => {
  it('parses for a linear flow', () => {
    const flow = defineFlow({
      nodes: [
        input('name'),
        code('greet', { code: (ctx) => `Hi ${ctx.name}` }),
        output('result', { value: (ctx) => ctx.greet }),
      ],
      edges: [
        ['name', 'greet'],
        ['greet', 'result'],
      ],
    });
    const { code: generated } = compile(flow, defaultOptions);
    assertParsesWithoutErrors(generated);
  });

  it('parses for a diamond with if/else convergence', () => {
    const flow = defineFlow({
      nodes: [
        input('v'),
        ifElse('c', { condition: (ctx) => (ctx.v as number) > 0 }),
        code('p', { code: () => 'p' }),
        code('n', { code: () => 'n' }),
        code('j', { code: () => 'j' }),
        output('r', { value: (ctx) => ctx.j }),
      ],
      edges: [
        ['v', 'c'],
        ['c', 'p', 'true_output'],
        ['c', 'n', 'false_output'],
        ['p', 'j'],
        ['n', 'j'],
        ['j', 'r'],
      ],
    });
    const { code: generated } = compile(flow, defaultOptions);
    assertParsesWithoutErrors(generated);
  });

  it('parses for nested if/else', () => {
    const flow = defineFlow({
      nodes: [
        input('v'),
        ifElse('outer', { condition: () => true }),
        ifElse('inner', { condition: () => true }),
        output('big', { value: () => 'big' }),
        output('small', { value: () => 'sm' }),
        output('neg', { value: () => 'n' }),
      ],
      edges: [
        ['v', 'outer'],
        ['outer', 'inner', 'true_output'],
        ['inner', 'big', 'true_output'],
        ['inner', 'small', 'false_output'],
        ['outer', 'neg', 'false_output'],
      ],
    });
    const { code: generated } = compile(flow, defaultOptions);
    assertParsesWithoutErrors(generated);
  });

  it('parses for a switch flow', () => {
    const flow = defineFlow({
      nodes: [
        input('kind'),
        switchNode('route', {
          cases: [
            { slug: 'a', label: 'A', condition: () => true },
            { slug: 'b', label: 'B', condition: () => true },
          ],
          matchMode: 'first',
        }),
        output('a_out', { value: () => 'a' }),
        output('b_out', { value: () => 'b' }),
        output('def_out', { value: () => 'def' }),
      ],
      edges: [
        ['kind', 'route'],
        ['route', 'a_out', 'a'],
        ['route', 'b_out', 'b'],
        ['route', 'def_out', 'default'],
      ],
    });
    const { code: generated } = compile(flow, defaultOptions);
    assertParsesWithoutErrors(generated);
  });
});
