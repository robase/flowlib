import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { locateValidationRange, produceDiagnostics } from '../../src/diagnostics/flowDiagnostics';

function fakeDoc(text: string): vscode.TextDocument {
  return {
    getText: () => text,
    positionAt: (offset: number) => {
      const before = text.slice(0, offset);
      const lines = before.split('\n');
      return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
    },
    uri: vscode.Uri.parse('untitled:test.flow.ts'),
    lineCount: text.split('\n').length,
  } as unknown as vscode.TextDocument;
}

suite('produceDiagnostics — parse failures', () => {
  test('emits one error diagnostic for parse failure', () => {
    const doc = fakeDoc('boom');
    const diags = produceDiagnostics({
      document: doc,
      parseResult: { ok: false, error: 'Footer JSON parse error: oops' },
    });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diags[0].source, 'flowlib');
    assert.equal(diags[0].code, 'parse-error');
    assert.match(diags[0].message, /Footer JSON parse error/);
  });

  test('respects 1-based line hint when present', () => {
    const doc = fakeDoc('line1\nline2\nline3\n');
    const diags = produceDiagnostics({
      document: doc,
      parseResult: { ok: false, error: 'oops', line: 3 },
    });
    assert.equal(diags[0].range.start.line, 2); // 1-based → 0-based
  });
});

suite('produceDiagnostics — validation', () => {
  test('valid flow produces no diagnostics', () => {
    const doc = fakeDoc('export default defineFlow(...);');
    const diags = produceDiagnostics({
      document: doc,
      parseResult: {
        ok: true,
        source: 'footer',
        flow: { nodes: [], edges: [] } as unknown as Parameters<
          typeof produceDiagnostics
        >[0]['parseResult'] extends { ok: true; flow: infer F }
          ? F
          : never,
      },
    });
    assert.deepEqual(diags, []);
  });

  test('duplicate referenceId surfaces as flow-validation diagnostic', () => {
    const doc = fakeDoc(`defineFlow({
      nodes: [
        { referenceId: 'dup', type: 'trigger.manual', params: {} },
        { referenceId: 'dup', type: 'core.output', params: {} },
      ],
      edges: [],
    });`);
    const flow = {
      nodes: [
        { referenceId: 'dup', type: 'trigger.manual', params: {} },
        { referenceId: 'dup', type: 'core.output', params: {} },
      ],
      edges: [],
    } as unknown as Parameters<typeof produceDiagnostics>[0]['parseResult'] extends {
      ok: true;
      flow: infer F;
    }
      ? F
      : never;
    const diags = produceDiagnostics({
      document: doc,
      parseResult: { ok: true, source: 'footer', flow },
    });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].source, 'flowlib');
    assert.equal(diags[0].code, 'flow-validation');
    assert.match(diags[0].message, /duplicate referenceId "dup"/);
  });

  test('edge to nonexistent target maps to the offending literal', () => {
    const src = `defineFlow({
  nodes: [{ referenceId: 'src', type: 'trigger.manual', params: {} }],
  edges: [{ from: 'src', to: 'missing' }],
});`;
    const doc = fakeDoc(src);
    const flow = {
      nodes: [{ referenceId: 'src', type: 'trigger.manual', params: {} }],
      edges: [{ from: 'src', to: 'missing' }],
    } as unknown as Parameters<typeof produceDiagnostics>[0]['parseResult'] extends {
      ok: true;
      flow: infer F;
    }
      ? F
      : never;
    const diags = produceDiagnostics({
      document: doc,
      parseResult: { ok: true, source: 'footer', flow },
    });
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /unknown target "missing"/);
    // Range should land on the 'missing' literal, not at line 0
    const offset = src.indexOf("'missing'");
    assert.ok(offset >= 0);
    const expected = doc.positionAt(offset);
    assert.equal(diags[0].range.start.line, expected.line);
  });
});

suite('locateValidationRange', () => {
  test('returns 0,0,0,0 when message has no referenceId-shaped match', () => {
    const range = locateValidationRange(fakeDoc('whatever'), 'random failure');
    assert.equal(range.start.line, 0);
    assert.equal(range.end.character, 0);
  });
});
