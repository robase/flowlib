/**
 * math_eval — safe mathematical expression evaluator.
 *
 * Exposed as both a flow node and an agent tool. Supports the standard
 * arithmetic operators (+, -, *, /, %, ^), parentheses, named variables,
 * and a whitelist of Math.* functions.
 *
 * ID intentionally remains `math_eval` (not `core.math_eval`) so existing
 * flows, agent tool references, and tests continue to resolve.
 */

import { defineAction } from '@flowlib/action-kit';
import { CORE_PROVIDER } from '../providers';
import { z } from 'zod/v4';

const paramsSchema = z.object({
  expression: z.string().min(1, 'Expression is required'),
  variables: z.record(z.string(), z.number()).optional(),
});

const mathFunctions: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  random: Math.random,
};

const mathConstants: Record<string, number> = {
  PI: Math.PI,
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
};

function evaluateMathExpression(
  expression: string,
  variables: Record<string, number> = {},
): number {
  const safePattern = /^[\d\s+\-*/().,%^a-zA-Z_]+$/;
  if (!safePattern.test(expression)) {
    throw new Error(`Invalid characters in expression: ${expression}`);
  }

  let processedExpr = expression;
  for (const [name, value] of Object.entries(mathConstants)) {
    // oxlint-disable-next-line security/detect-non-literal-regexp -- name from validated allowlist
    const regex = new RegExp(`\\b${name}\\b`, 'g');
    processedExpr = processedExpr.replace(regex, String(value));
  }

  for (const [name, value] of Object.entries(variables)) {
    // oxlint-disable-next-line security/detect-non-literal-regexp -- name from validated variables keys
    const regex = new RegExp(`\\b${name}\\b`, 'g');
    processedExpr = processedExpr.replace(regex, String(value));
  }

  processedExpr = processedExpr.replace(/\^/g, '**');
  // oxlint-disable-next-line security/detect-unsafe-regex -- standard number literal
  processedExpr = processedExpr.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1 * 0.01)');

  for (const funcName of Object.keys(mathFunctions)) {
    // oxlint-disable-next-line security/detect-non-literal-regexp -- funcName from allowlist
    const regex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
    processedExpr = processedExpr.replace(regex, `Math.${funcName}(`);
  }

  const funcCallPattern = /\b(?!Math\.)[a-zA-Z_][a-zA-Z0-9_]*\s*\(/;
  if (funcCallPattern.test(processedExpr)) {
    throw new Error(`Unsupported function call in expression: ${expression}`);
  }

  const evaluator = new Function('Math', `"use strict"; return (${processedExpr});`);
  const result = evaluator(Math);

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error(`Invalid result: ${result}`);
  }

  return result;
}

export const mathEvalAction = defineAction({
  id: 'math_eval',
  name: 'Math Evaluate',
  description:
    'Evaluate mathematical expressions. Use this for arithmetic calculations, percentages, and basic math operations. Supports: +, -, *, /, %, ^, parentheses, and common functions like sqrt, sin, cos, tan, log, exp, abs, round, floor, ceil.',
  provider: CORE_PROVIDER,
  icon: 'Calculator',
  tags: ['math', 'calculation', 'arithmetic'],

  params: {
    schema: paramsSchema,
    fields: [
      {
        name: 'expression',
        label: 'Expression',
        type: 'text',
        required: true,
        description:
          "Mathematical expression to evaluate. Examples: '2 + 3 * 4', 'sqrt(16)', '(100 - 20) / 5', 'round(3.7)'",
        placeholder: '2 + 3 * 4',
      },
      {
        name: 'variables',
        label: 'Variables',
        type: 'json',
        required: false,
        description:
          'Optional variables to substitute in the expression. Example: { "x": 5, "y": 10 } for expression "x + y".',
      },
    ],
  },

  async execute(params, context) {
    const { expression, variables = {} } = params;

    context.logger.debug('Executing math_eval', { expression, variables });

    try {
      const result = evaluateMathExpression(expression.trim(), variables);
      return { success: true, output: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.error('math_eval execution failed', { error: message });
      return { success: false, error: `Math evaluation failed: ${message}` };
    }
  },
});
