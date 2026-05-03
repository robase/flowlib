import { describe, it, expect } from 'vitest';
import { compileFlow, scaffoldProject } from '../src/compiler/flow-compiler';
import type { CompileInput } from '../src/compiler/flow-compiler';

describe('compileFlow', () => {
  const baseInput: CompileInput = {
    flowId: 'test-flow-1',
    flowName: 'My Test Flow',
    version: 1,
    definition: {
      nodes: [
        {
          id: 'n1',
          type: 'trigger.manual',
          label: 'User Input',
          referenceId: 'user_input',
          params: {},
          position: { x: 0, y: 0 },
        },
        {
          id: 'n2',
          type: 'http.request',
          label: 'Fetch Data',
          referenceId: 'fetch_data',
          params: { url: 'https://api.example.com/users/{{ user_input.id }}', method: 'GET' },
          position: { x: 200, y: 0 },
        },
        {
          id: 'n3',
          type: 'core.jq',
          label: 'Transform',
          referenceId: 'transform',
          params: { query: '.name' },
          position: { x: 400, y: 0 },
        },
        {
          id: 'n4',
          type: 'core.output',
          label: 'Result',
          referenceId: 'result',
          params: {},
          position: { x: 600, y: 0 },
        },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
      ],
    },
  };

  it('should compile a simple linear flow', () => {
    const result = compileFlow(baseInput);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('src/workflow.ts');

    const source = result.files[0].content;
    expect(source).toContain('class MyTestFlowWorkflow');
    expect(source).toContain('WorkflowEntrypoint');
    expect(source).toContain('WorkflowStep');
    expect(source).toContain('WorkflowEvent');
    expect(source).toContain('interface Env');
    expect(source).toContain('step.do("fetch_data"');
    expect(source).toContain('step.do("transform"');
    expect(source).toContain('jqTransform');
    expect(source).not.toContain('step.reportComplete');
  });

  it('should track metadata correctly', () => {
    const result = compileFlow(baseInput);
    expect(result.metadata.flowId).toBe('test-flow-1');
    expect(result.metadata.flowName).toBe('My Test Flow');
    expect(result.metadata.version).toBe(1);
    expect(result.metadata.nodeCount).toBe(4);
    expect(result.metadata.actionIds).toContain('trigger.manual');
    expect(result.metadata.actionIds).toContain('http.request');
    expect(result.metadata.actionIds).toContain('core.jq');
    expect(result.metadata.usesAI).toBe(false);
    expect(result.metadata.hasBranching).toBe(false);
  });

  it('should compile a flow with AI model node', () => {
    const input: CompileInput = {
      ...baseInput,
      definition: {
        nodes: [
          { id: 'n1', type: 'trigger.manual', label: 'Input', referenceId: 'input', params: {} },
          {
            id: 'n2',
            type: 'core.model',
            label: 'Summarize',
            referenceId: 'summary',
            params: { prompt: 'Summarize: {{ input }}', model: 'gpt-4o-mini' },
          },
          { id: 'n3', type: 'core.output', label: 'Output', referenceId: 'output', params: {} },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
      },
    };

    const result = compileFlow(input);
    expect(result.success).toBe(true);
    expect(result.metadata.usesAI).toBe(true);

    const source = result.files[0].content;
    expect(source).toContain('new OpenAI');
    expect(source).toContain('chat.completions.create');
    expect(source).toContain('gpt-4o-mini');
    expect(source).toContain('OPENAI_API_KEY');
    expect(source).not.toContain('generateText');
    expect(source).not.toContain('@ai-sdk');
  });

  it('should compile a flow with if-else branching', () => {
    const input: CompileInput = {
      ...baseInput,
      definition: {
        nodes: [
          { id: 'n1', type: 'trigger.manual', label: 'Input', referenceId: 'input', params: {} },
          {
            id: 'n2',
            type: 'core.if_else',
            label: 'Check Active',
            referenceId: 'check',
            params: { condition: 'input.active === true' },
          },
          {
            id: 'n3',
            type: 'core.template_string',
            label: 'Active Msg',
            referenceId: 'active_msg',
            params: { template: 'User is active' },
          },
          { id: 'n4', type: 'core.output', label: 'Output', referenceId: 'output', params: {} },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'true_output' },
          { id: 'e3', source: 'n3', target: 'n4' },
        ],
      },
    };

    const result = compileFlow(input);
    expect(result.success).toBe(true);
    expect(result.metadata.hasBranching).toBe(true);

    const source = result.files[0].content;
    expect(source).toContain('branchConditions');
    expect(source).toContain('if (branchConditions["check"])');
  });

  it('should warn for unsupported action types', () => {
    const input: CompileInput = {
      ...baseInput,
      definition: {
        nodes: [
          { id: 'n1', type: 'trigger.manual', label: 'Input', referenceId: 'input', params: {} },
          {
            id: 'n2',
            type: 'gmail.send_message',
            label: 'Send Email',
            referenceId: 'email',
            params: {},
          },
          { id: 'n3', type: 'core.output', label: 'Output', referenceId: 'output', params: {} },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
      },
    };

    const result = compileFlow(input);
    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('gmail.send_message');
    expect(result.warnings[0]).toContain('passthrough');
  });

  it('should fail on cyclic flows', () => {
    const input: CompileInput = {
      ...baseInput,
      definition: {
        nodes: [
          { id: 'n1', type: 'trigger.manual', label: 'A', referenceId: 'a', params: {} },
          { id: 'n2', type: 'core.jq', label: 'B', referenceId: 'b', params: { query: '.' } },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n1' },
        ],
      },
    };

    const result = compileFlow(input);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('cycle');
  });

  it('should use standalone workflow target', () => {
    const result = compileFlow({ ...baseInput, target: 'standalone-workflow' });
    expect(result.success).toBe(true);

    const source = result.files[0].content;
    expect(source).toContain('WorkflowEntrypoint');
    expect(source).not.toContain('AgentWorkflow');
  });
});

describe('scaffoldProject', () => {
  it('should scaffold a full agent-workflow project', () => {
    const compileResult = compileFlow({
      flowId: 'f1',
      flowName: 'Data Pipeline',
      version: 1,
      definition: {
        nodes: [
          { id: 'n1', type: 'trigger.manual', label: 'Input', referenceId: 'input', params: {} },
          { id: 'n2', type: 'core.output', label: 'Output', referenceId: 'output', params: {} },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      },
    });

    const files = scaffoldProject(compileResult, {
      flowName: 'Data Pipeline',
      target: 'agent-workflow',
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('wrangler.jsonc');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/workflow.ts');

    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.dependencies.agents).toBeDefined();
    expect(pkg.dependencies.wrangler).toBeDefined();
    expect(pkg.dependencies.ai).toBeUndefined();
    expect(pkg.dependencies['@ai-sdk/openai']).toBeUndefined();

    const wrangler = JSON.parse(files.find((f) => f.path === 'wrangler.jsonc')!.content);
    expect(wrangler.compatibility_flags).toContain('nodejs_compat');
    expect(wrangler.observability).toEqual({ enabled: true });

    const entrypoint = files.find((f) => f.path === 'src/index.ts')!.content;
    expect(entrypoint).toContain('FlowAgent');
    expect(entrypoint).toContain('routeAgentRequest');
    expect(entrypoint).toContain('DataPipelineWorkflow');
    expect(entrypoint).toContain('this.env.FLOW_WORKFLOW.create');
    expect(entrypoint).toContain('interface Env');
    expect(entrypoint).not.toContain('this.runWorkflow');
    expect(entrypoint).not.toContain('this.getWorkflowStatus');
  });

  it('should scaffold a standalone-workflow project', () => {
    const compileResult = compileFlow({
      flowId: 'f1',
      flowName: 'Simple Flow',
      version: 1,
      target: 'standalone-workflow',
      definition: {
        nodes: [
          { id: 'n1', type: 'trigger.manual', label: 'Input', referenceId: 'input', params: {} },
          { id: 'n2', type: 'core.output', label: 'Output', referenceId: 'output', params: {} },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      },
    });

    const files = scaffoldProject(compileResult, {
      flowName: 'Simple Flow',
      target: 'standalone-workflow',
    });

    const entrypoint = files.find((f) => f.path === 'src/index.ts')!.content;
    expect(entrypoint).not.toContain('FlowAgent');
    expect(entrypoint).toContain('FLOW_WORKFLOW');
  });
});
