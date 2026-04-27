#!/usr/bin/env npx tsx
/**
 * Visual Audit — AI Analysis & Report Generation
 *
 * Reads screenshots + metadata.json from the capture phase, sends each to
 * an AI vision model for UX analysis, and generates a Markdown report.
 *
 * Two-pass approach:
 *   Pass 1: Per-screen analysis (parallel, 4 at a time)
 *   Pass 2: Cross-screen synthesis (single call, text only)
 *
 * Supports:
 *   - ANTHROPIC_API_KEY → Claude Sonnet (primary)
 *   - OPENAI_API_KEY    → GPT-4o (fallback)
 *
 * Run: pnpm ux:analyze
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from visual-audit directory (no dotenv dependency needed)
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const OUTPUT_DIR = path.resolve(__dirname, 'output');
const SCREENSHOTS_DIR = path.join(OUTPUT_DIR, 'screenshots');
const METADATA_PATH = path.join(OUTPUT_DIR, 'metadata.json');
const REPORT_PATH = path.join(OUTPUT_DIR, 'REPORT.md');

// ─── Types ────────────────────────────────────────────────────────────────

interface ScreenshotMeta {
  id: string;
  filename: string;
  focusCrop: string | null;
  description: string;
  url: string;
  tags: string[];
  viewport: { width: number; height: number };
}

interface ScreenAnalysis {
  meta: ScreenshotMeta;
  findings: string;
}

// ─── Prompts ──────────────────────────────────────────────────────────────

function perScreenPrompt(meta: ScreenshotMeta): string {
  return `You are a senior product designer reviewing "Flowlib" — a workflow orchestration tool with a visual flow editor for building AI pipelines. The target audience is technical users (developers, data engineers) — think Figma, n8n, VS Code, or Retool.

Analyze this screenshot of: ${meta.description}
Page URL: ${meta.url}
Context tags: ${meta.tags.join(', ')}
Viewport: ${meta.viewport.width}×${meta.viewport.height}

Evaluate and provide findings in these categories:

1. **Visual Design Quality** — Does this look like a polished, professional tool? Color palette cohesion, use of depth/shadows, border treatments, icon quality, overall aesthetic. Compare to best-in-class developer tools.

2. **Layout & Information Hierarchy** — Visual weight distribution, whitespace usage, alignment grid, content density (too sparse or too cramped?), scan-path flow, grouping and sectioning clarity.

3. **Component & Pattern Consistency** — Spacing rhythm, typography scale, button/input styles, card treatments, consistent use of design tokens across the screen.

4. **Interaction Design** — Do interactive elements look interactive? Are states clear (hover, selected, disabled)? Is feedback visible? Are primary actions prominent and secondary actions subdued? Is the information architecture intuitive?

5. **Specific Suggestions** — 2-3 concrete, actionable design improvements with rationale. Reference specific elements in the screenshot.

Be direct and opinionated. Compare against tools like Figma, Linear, Raycast, n8n, or VS Code where relevant. Focus on what would make this feel like a premium, well-crafted developer tool.`;
}

function synthesisPrompt(count: number, allFindings: string): string {
  return `You've reviewed ${count} screens of the Flowlib workflow editor — a developer tool comparable to Figma, n8n, or VS Code. Below are your per-screen findings.

${allFindings}

Now synthesize:

1. **Design System Assessment** — Is there a coherent visual language? Where does it break down? What's missing?
2. **Top 10 Priority Design Changes** — Ranked by visual/UX impact. For each: the issue, which screens it affects, and a concrete fix. Think about what would make this feel like a premium developer tool.
3. **Strongest Design Elements** — What's already working well (2-3 points). Be specific.
4. **Overall Design Score** — Rate 1-10 with brief justification. Benchmark against tools like Linear, Figma, n8n.`;
}

// ─── Provider Abstraction ─────────────────────────────────────────────────

interface AIProvider {
  name: string;
  model: string;
  analyzeImage(prompt: string, imageBase64: string, mimeType: string): Promise<string>;
  textCompletion(prompt: string): Promise<string>;
}

async function createAnthropicProvider(): Promise<AIProvider> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = 'claude-opus-4-6';

  return {
    name: 'Anthropic',
    model,
    async analyzeImage(prompt, imageBase64, mimeType) {
      const resp = await client.messages.create({
        model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType as 'image/png', data: imageBase64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
      return resp.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    },
    async textCompletion(prompt) {
      const resp = await client.messages.create({
        model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      });
      return resp.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    },
  };
}

async function createOpenAIProvider(): Promise<AIProvider> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = 'gpt-4o';

  return {
    name: 'OpenAI',
    model,
    async analyzeImage(prompt, imageBase64, mimeType) {
      const resp = await client.chat.completions.create({
        model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });
      return resp.choices[0]?.message?.content ?? '';
    },
    async textCompletion(prompt) {
      const resp = await client.chat.completions.create({
        model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      });
      return resp.choices[0]?.message?.content ?? '';
    },
  };
}

// ─── Concurrency helper ──────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length }) as R[];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ─── Report generation ────────────────────────────────────────────────────

function generateReport(
  analyses: ScreenAnalysis[],
  synthesis: string,
  provider: AIProvider,
  timestamp: string,
): string {
  const lines: string[] = [
    '# Flowlib UI Visual Audit Report',
    '',
    `> Generated: ${timestamp} | Model: ${provider.model} (${provider.name}) | Screenshots: ${analyses.length}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    synthesis,
    '',
    '---',
    '',
    '## Per-Screen Analysis',
    '',
  ];

  for (const { meta, findings } of analyses) {
    lines.push(`### ${meta.id.replace(/^\d+-/, (m) => m)} — ${meta.description.split('.')[0]}`);
    lines.push('');
    lines.push(`![${meta.id}](screenshots/${meta.filename})`);
    if (meta.focusCrop) {
      lines.push('');
      lines.push(`<details><summary>Focused crop</summary>`);
      lines.push('');
      lines.push(`![${meta.id}-focus](screenshots/${meta.focusCrop})`);
      lines.push('');
      lines.push(`</details>`);
    }
    lines.push('');
    lines.push(
      `**URL:** \`${meta.url}\` | **Viewport:** ${meta.viewport.width}×${meta.viewport.height} | **Tags:** ${meta.tags.map((t) => `\`${t}\``).join(', ')}`,
    );
    lines.push('');
    lines.push(findings);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  // Validate inputs
  if (!fs.existsSync(METADATA_PATH)) {
    console.error('❌ No metadata.json found. Run `pnpm ux:capture` first.');
    process.exit(1);
  }

  const metadata: ScreenshotMeta[] = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
  if (metadata.length === 0) {
    console.error('❌ metadata.json is empty — no screenshots to analyze.');
    process.exit(1);
  }

  // Select AI provider
  let provider: AIProvider;
  if (process.env.ANTHROPIC_API_KEY) {
    console.log('🤖 Using Anthropic Claude for analysis...');
    provider = await createAnthropicProvider();
  } else if (process.env.OPENAI_API_KEY) {
    console.log('🤖 Using OpenAI GPT-4o for analysis...');
    provider = await createOpenAIProvider();
  } else {
    console.error('❌ No AI API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
    process.exit(1);
  }

  console.log(`📸 Analyzing ${metadata.length} screenshots with ${provider.model}...\n`);

  // Pass 1: Per-screen analysis (4 concurrent)
  const analyses = await runWithConcurrency(metadata, 4, async (meta, idx) => {
    const imagePath = path.join(SCREENSHOTS_DIR, meta.filename);
    if (!fs.existsSync(imagePath)) {
      console.warn(`⚠️  Skipping ${meta.id} — screenshot not found`);
      return { meta, findings: '*Screenshot file missing — skipped.*' };
    }

    const imageBase64 = fs.readFileSync(imagePath).toString('base64');
    const prompt = perScreenPrompt(meta);

    console.log(`  [${idx + 1}/${metadata.length}] Analyzing: ${meta.id}`);
    const findings = await provider.analyzeImage(prompt, imageBase64, 'image/png');
    console.log(`  ✓ ${meta.id}`);

    return { meta, findings } as ScreenAnalysis;
  });

  // Pass 2: Cross-screen synthesis
  console.log('\n🔍 Synthesizing cross-screen findings...');
  const allFindings = analyses.map((a) => `### ${a.meta.id}\n${a.findings}`).join('\n\n');
  const synthesis = await provider.textCompletion(synthesisPrompt(analyses.length, allFindings));

  // Generate report
  const timestamp = new Date().toISOString();
  const report = generateReport(analyses, synthesis, provider, timestamp);

  fs.writeFileSync(REPORT_PATH, report);
  console.log(`\n✅ Report generated → ${REPORT_PATH}`);
  console.log(`   ${analyses.length} screens analyzed, ${report.length} chars written`);
}

main().catch((err) => {
  console.error('❌ Analysis failed:', err);
  process.exit(1);
});
