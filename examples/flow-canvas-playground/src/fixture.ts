/**
 * Fixture flow + action catalogue for the FlowCanvas playground.
 *
 * Mirrors the shape of `pkg/core/tests/e2e/complex-branching-flow.ts`
 * but written directly as a plain `FlowlibDefinition` to keep the
 * playground off the `@flowlib/sdk` dependency graph.
 */

import type { FlowlibDefinition } from '@flowlib/core/types';
import type { ActionMetadata } from '@flowlib/ui/flow-canvas';

export const fixtureFlow: FlowlibDefinition = {
  nodes: [
    {
      id: 'input_1',
      type: 'trigger.manual',
      position: { x: 0, y: 120 },
      params: {
        variableName: 'user_data',
        defaultValue: JSON.stringify({ name: 'Alice', age: 25 }),
      },
      label: 'User Data',
    },
    {
      id: 'transform_1',
      type: 'core.javascript',
      position: { x: 280, y: 120 },
      params: {
        code: 'const d = user_data; return { name: d.name, age: d.age, isAdult: d.age >= 18 }',
      },
      label: 'Extract User Info',
    },
    {
      id: 'ifelse_1',
      type: 'core.if_else',
      position: { x: 560, y: 120 },
      params: {
        condition: '{{ transform_1.isAdult }}',
      },
      label: 'Is Adult?',
    },
    {
      id: 'template_adult',
      type: 'core.template_string',
      position: { x: 840, y: 40 },
      params: {
        template: 'Welcome {{ ifelse_1.name }}!',
      },
      label: 'Adult Message',
    },
    {
      id: 'template_minor',
      type: 'core.template_string',
      position: { x: 840, y: 200 },
      params: {
        template: 'Hi {{ ifelse_1.name }} — restricted mode.',
      },
      label: 'Minor Message',
    },
  ] as FlowlibDefinition['nodes'],
  edges: [
    { id: 'e1', source: 'input_1', target: 'transform_1' },
    { id: 'e2', source: 'transform_1', target: 'ifelse_1' },
    {
      id: 'e3',
      source: 'ifelse_1',
      target: 'template_adult',
      sourceHandle: 'true_output',
    },
    {
      id: 'e4',
      source: 'ifelse_1',
      target: 'template_minor',
      sourceHandle: 'false_output',
    },
  ],
};

/**
 * Minimal action catalogue used by the playground. In the VSCode
 * extension, this will be replaced by the build-time codegen output
 * from `@flowlib/actions` (Lane L7).
 */
export const fixtureActions: ActionMetadata[] = [
  {
    type: 'trigger.manual',
    label: 'Flow Input',
    description: 'Defines a named flow input variable.',
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [
      { name: 'variableName', label: 'Variable Name', type: 'text', required: true },
      { name: 'defaultValue', label: 'Default Value', type: 'textarea' },
    ],
    provider: { id: 'core', name: 'Core', icon: 'Input' },
  },
  {
    type: 'core.javascript',
    label: 'JavaScript',
    description: 'Run an arbitrary JavaScript expression.',
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [{ name: 'code', label: 'Code', type: 'code', required: true }],
    provider: { id: 'core', name: 'Core', icon: 'Code' },
  },
  {
    type: 'core.if_else',
    label: 'If/Else',
    description: 'Branch execution based on a condition.',
    outputs: [
      { id: 'true_output', label: 'True', type: 'any' },
      { id: 'false_output', label: 'False', type: 'any' },
    ],
    paramFields: [{ name: 'condition', label: 'Condition', type: 'text', required: true }],
    provider: { id: 'core', name: 'Core', icon: 'GitBranch' },
  },
  {
    type: 'core.template_string',
    label: 'Template String',
    description: 'Render a template string from upstream inputs.',
    outputs: [{ id: 'output', label: 'Output', type: 'any' }],
    paramFields: [{ name: 'template', label: 'Template', type: 'textarea', required: true }],
    provider: { id: 'core', name: 'Core', icon: 'FileText' },
  },
];
