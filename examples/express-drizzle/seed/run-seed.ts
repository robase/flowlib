#!/usr/bin/env tsx
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Flowlib, type FlowlibDefinition } from '@flowlib/core';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(currentDir, '../dev.db');

console.log('🌱 Running Flowlib seed scripts...\n');

// Store credential ID for use in flows
const anthropicCredentialId: string | null = null;

/**
 * Complex Branching Flow: User Age Check
 *
 * Flow structure:
 *   Input (user_data)
 *       ↓
 *   JQ (extract/transform)
 *       ↓
 *   If-Else (age >= 18?)
 *      ↓ True          ↓ False
 *   Template         Template
 *   (adult msg)      (minor msg)
 */
function buildComplexBranchingFlow(isAdult: boolean): FlowlibDefinition {
  const userData = {
    name: isAdult ? 'Alice' : 'Bobby',
    age: isAdult ? 25 : 15,
    email: isAdult ? 'alice@example.com' : 'bobby@example.com',
  };

  return {
    nodes: [
      {
        id: 'input-user',
        type: 'trigger.manual',
        label: 'User Data',
        referenceId: 'user_data',
        params: {
          variableName: 'user',
          defaultValue: JSON.stringify(userData),
        },
        position: { x: 100, y: 200 },
      },
      {
        id: 'jq-extract',
        type: 'core.jq',
        label: 'Extract User Info',
        referenceId: 'user_info',
        params: {
          query: '.user_data | { name: .name, age: .age, isAdult: (.age >= 18) }',
        },
        position: { x: 350, y: 200 },
      },
      {
        id: 'if-adult',
        type: 'core.if_else',
        label: 'Is Adult?',
        referenceId: 'age_check',
        params: {
          condition: { '==': [{ var: 'user_info.isAdult' }, true] },
        },
        position: { x: 600, y: 200 },
      },
      {
        id: 'template-adult',
        type: 'core.template_string',
        label: 'Adult Message',
        referenceId: 'adult_message',
        params: {
          template: 'Welcome {{ age_check.user_info.name }}! You have full access to all features.',
        },
        position: { x: 900, y: 100 },
      },
      {
        id: 'template-minor',
        type: 'core.template_string',
        label: 'Minor Message',
        referenceId: 'minor_message',
        params: {
          template:
            'Hi {{ age_check.user_info.name }}! Some features are restricted for users under 18.',
        },
        position: { x: 900, y: 300 },
      },
    ],
    edges: [
      { id: 'edge-input-to-jq', source: 'input-user', target: 'jq-extract' },
      { id: 'edge-jq-to-ifelse', source: 'jq-extract', target: 'if-adult' },
      {
        id: 'edge-ifelse-true',
        source: 'if-adult',
        target: 'template-adult',
        sourceHandle: 'true_output',
      },
      {
        id: 'edge-ifelse-false',
        source: 'if-adult',
        target: 'template-minor',
        sourceHandle: 'false_output',
      },
    ],
    metadata: {
      name: 'User Age Check Flow',
      description: 'Demonstrates Input → JQ → If-Else → Template branching',
      created: new Date().toISOString(),
    },
  };
}

/**
 * Simple Template Flow: Topic Summary
 *
 * Flow structure:
 *   Input (topic) → Template String (prompt) → Output
 */
function buildSimpleTemplateFlow(): FlowlibDefinition {
  return {
    nodes: [
      {
        id: 'input-topic',
        type: 'trigger.manual',
        label: 'Topic Input',
        referenceId: 'topic',
        params: {
          variableName: 'topic',
          defaultValue: 'artificial intelligence',
        },
        position: { x: 100, y: 200 },
      },
      {
        id: 'template-prompt',
        type: 'core.template_string',
        label: 'Build Prompt',
        referenceId: 'prompt',
        params: {
          template: 'Write a brief 2-sentence explanation about: {{ topic }}',
        },
        position: { x: 400, y: 200 },
      },
    ],
    edges: [{ id: 'edge-input-to-template', source: 'input-topic', target: 'template-prompt' }],
    metadata: {
      name: 'Simple Template Flow',
      description: 'Demonstrates Input → Template String with Nunjucks',
      created: new Date().toISOString(),
    },
  };
}

/**
 * JQ Data Transformation Flow
 *
 * Flow structure:
 *   Input (JSON) → JQ (transform) → Template (format)
 */
function buildJqTransformFlow(): FlowlibDefinition {
  const sampleData = {
    users: [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
      { id: 3, name: 'Charlie', role: 'admin' },
    ],
    metadata: { total: 3, page: 1 },
  };

  return {
    nodes: [
      {
        id: 'input-data',
        type: 'trigger.manual',
        label: 'User List',
        referenceId: 'data',
        params: {
          variableName: 'users_json',
          defaultValue: JSON.stringify(sampleData),
        },
        position: { x: 100, y: 200 },
      },
      {
        id: 'jq-filter',
        type: 'core.jq',
        label: 'Filter Admins',
        referenceId: 'admins',
        params: {
          query:
            '.data | { admins: [.users[] | select(.role == "admin") | .name], count: ([.users[] | select(.role == "admin")] | length) }',
        },
        position: { x: 400, y: 200 },
      },
      {
        id: 'template-result',
        type: 'core.template_string',
        label: 'Format Result',
        referenceId: 'result',
        params: {
          template: 'Found {{ admins.count }} admin(s): {{ admins.admins | join(", ") }}',
        },
        position: { x: 700, y: 200 },
      },
    ],
    edges: [
      { id: 'edge-input-to-jq', source: 'input-data', target: 'jq-filter' },
      { id: 'edge-jq-to-template', source: 'jq-filter', target: 'template-result' },
    ],
    metadata: {
      name: 'JQ Data Transform',
      description: 'Demonstrates JQ queries for filtering and transforming JSON',
      created: new Date().toISOString(),
    },
  };
}

/**
 * Comprehensive Multi-Node Flow: E-Commerce Order Processing
 *
 * This flow demonstrates a realistic order processing pipeline with:
 * - Multiple inputs (order data, customer data)
 * - JQ data transformations (merge, calculate totals)
 * - Conditional branching (VIP customer check, order value check)
 * - Nested If-Else conditions
 * - Template strings for various messages
 * - AI model integration for personalized messages
 *
 * Flow structure:
 *   Order Input ──┬──→ JQ (merge) ──→ JQ (calc totals) ──→ If-Else (VIP?)
 *   Customer Input┘                                            │
 *                                         ┌────────────────────┴────────────────────┐
 *                                         ↓ True                                    ↓ False
 *                                   Template (VIP)                           If-Else (High Value?)
 *                                         │                                  ┌───────┴───────┐
 *                                         ↓                                  ↓ True          ↓ False
 *                                   Model (AI msg)                     Template (High)  Template (Std)
 *                                         │                                  │               │
 *                                         └──────────────────────────────────┴───────────────┘
 *                                                            ↓
 *                                                    JQ (final summary)
 */
function buildComprehensiveOrderFlow(): FlowlibDefinition {
  const sampleOrder = {
    orderId: 'ORD-2024-001',
    items: [
      { sku: 'LAPTOP-PRO', name: 'Laptop Pro 15', price: 1299.99, quantity: 1 },
      { sku: 'MOUSE-WL', name: 'Wireless Mouse', price: 49.99, quantity: 2 },
      { sku: 'KB-MECH', name: 'Mechanical Keyboard', price: 159.99, quantity: 1 },
    ],
    shippingAddress: {
      street: '123 Tech Street',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
    },
    paymentMethod: 'credit_card',
    createdAt: '2024-12-14T10:30:00Z',
  };

  const sampleCustomer = {
    customerId: 'CUST-001',
    name: 'Alice Johnson',
    email: 'alice@example.com',
    tier: 'VIP', // "VIP", "Premium", "Standard"
    totalOrders: 47,
    memberSince: '2020-03-15',
    preferences: {
      newsletter: true,
      promotions: true,
      language: 'en',
    },
  };

  return {
    nodes: [
      // ============ INPUTS ============
      {
        id: 'input-order',
        type: 'trigger.manual',
        label: 'Order Data',
        referenceId: 'order',
        params: {
          variableName: 'order',
          defaultValue: JSON.stringify(sampleOrder),
        },
        position: { x: 50, y: 100 },
      },
      {
        id: 'input-customer',
        type: 'trigger.manual',
        label: 'Customer Data',
        referenceId: 'customer',
        params: {
          variableName: 'customer',
          defaultValue: JSON.stringify(sampleCustomer),
        },
        position: { x: 50, y: 300 },
      },

      // ============ JQ: Merge Order & Customer ============
      {
        id: 'jq-merge',
        type: 'core.jq',
        label: 'Merge Data',
        referenceId: 'merged',
        params: {
          query: `{
  orderId: .order.orderId,
  customer: {
    id: .customer.customerId,
    name: .customer.name,
    email: .customer.email,
    tier: .customer.tier,
    totalOrders: .customer.totalOrders
  },
  items: .order.items,
  shipping: .order.shippingAddress,
  paymentMethod: .order.paymentMethod
}`,
        },
        position: { x: 300, y: 200 },
      },

      // ============ JQ: Calculate Order Totals ============
      {
        id: 'jq-totals',
        type: 'core.jq',
        label: 'Calculate Totals',
        referenceId: 'order_summary',
        params: {
          query: `.merged + {
  itemCount: (.merged.items | length),
  subtotal: ([.merged.items[] | .price * .quantity] | add),
  tax: (([.merged.items[] | .price * .quantity] | add) * 0.0875),
  total: (([.merged.items[] | .price * .quantity] | add) * 1.0875),
  isHighValue: (([.merged.items[] | .price * .quantity] | add) > 500),
  isVip: (.merged.customer.tier == "VIP")
}`,
        },
        position: { x: 550, y: 200 },
      },

      // ============ IF-ELSE: VIP Customer Check ============
      {
        id: 'if-vip',
        type: 'core.if_else',
        label: 'Is VIP Customer?',
        referenceId: 'vip_check',
        params: {
          condition: { '==': [{ var: 'order_summary.isVip' }, true] },
        },
        position: { x: 800, y: 200 },
      },

      // ============ TRUE BRANCH: VIP Processing ============
      {
        id: 'template-vip',
        type: 'core.template_string',
        label: 'VIP Welcome',
        referenceId: 'vip_message',
        params: {
          template: `🌟 VIP Order Confirmation 🌟

Dear {{ vip_check.order_summary.customer.name }},

Thank you for your continued loyalty! As a VIP member with {{ vip_check.order_summary.customer.totalOrders }} orders, you've earned:
- Priority shipping (FREE)
- 15% loyalty discount applied
- Dedicated support line

Order #{{ vip_check.order_summary.orderId }}
Items: {{ vip_check.order_summary.itemCount }}
Total: \${{ vip_check.order_summary.total | round(2) }}

Your order will be expedited!`,
        },
        position: { x: 1100, y: 50 },
      },

      // AI Model for VIP personalized message (optional - requires credential)
      {
        id: 'model-vip-ai',
        type: 'core.model',
        label: 'AI Personalized Note',
        referenceId: 'ai_note',
        params: {
          provider: 'ANTHROPIC',
          model: 'claude-3-haiku-20240307',
          credentialId: '', // Will be filled if credential exists
          prompt: `Write a short, warm, personalized thank-you note (2-3 sentences) for a VIP customer named {{ vip_message }} who just placed order #{{ vip_check.order_summary.orderId }}. Be genuine and appreciative.`,
          systemPrompt:
            'You are a friendly customer service representative. Keep responses brief and warm.',
          maxTokens: 150,
        },
        position: { x: 1400, y: 50 },
      },

      // ============ FALSE BRANCH: Regular Customer Processing ============
      {
        id: 'if-high-value',
        type: 'core.if_else',
        label: 'High Value Order?',
        referenceId: 'value_check',
        params: {
          condition: { '==': [{ var: 'vip_check.order_summary.isHighValue' }, true] },
        },
        position: { x: 1100, y: 300 },
      },

      // High Value Order Template
      {
        id: 'template-high-value',
        type: 'core.template_string',
        label: 'High Value Message',
        referenceId: 'high_value_message',
        params: {
          template: `✨ Thank You for Your Order! ✨

Dear {{ value_check.vip_check.order_summary.customer.name }},

We appreciate your substantial order!

Order #{{ value_check.vip_check.order_summary.orderId }}
Items: {{ value_check.vip_check.order_summary.itemCount }}
Subtotal: \${{ value_check.vip_check.order_summary.subtotal | round(2) }}
Tax: \${{ value_check.vip_check.order_summary.tax | round(2) }}
Total: \${{ value_check.vip_check.order_summary.total | round(2) }}

🎁 Special offer: Use code THANKYOU10 for 10% off your next order!

Shipping to:
{{ value_check.vip_check.order_summary.shipping.street }}
{{ value_check.vip_check.order_summary.shipping.city }}, {{ value_check.vip_check.order_summary.shipping.state }} {{ value_check.vip_check.order_summary.shipping.zip }}`,
        },
        position: { x: 1400, y: 200 },
      },

      // Standard Order Template
      {
        id: 'template-standard',
        type: 'core.template_string',
        label: 'Standard Message',
        referenceId: 'standard_message',
        params: {
          template: `Order Confirmation

Dear {{ value_check.vip_check.order_summary.customer.name }},

Thank you for your order!

Order #{{ value_check.vip_check.order_summary.orderId }}
Items: {{ value_check.vip_check.order_summary.itemCount }}
Total: \${{ value_check.vip_check.order_summary.total | round(2) }}

Estimated delivery: 5-7 business days

Shipping to:
{{ value_check.vip_check.order_summary.shipping.city }}, {{ value_check.vip_check.order_summary.shipping.state }}`,
        },
        position: { x: 1400, y: 400 },
      },
    ],
    edges: [
      // Inputs → Merge
      { id: 'e-order-merge', source: 'input-order', target: 'jq-merge' },
      { id: 'e-customer-merge', source: 'input-customer', target: 'jq-merge' },

      // Merge → Calculate Totals
      { id: 'e-merge-totals', source: 'jq-merge', target: 'jq-totals' },

      // Totals → VIP Check
      { id: 'e-totals-vip', source: 'jq-totals', target: 'if-vip' },

      // VIP True → VIP Template → AI
      { id: 'e-vip-true', source: 'if-vip', target: 'template-vip', sourceHandle: 'true_output' },
      { id: 'e-vip-ai', source: 'template-vip', target: 'model-vip-ai' },

      // VIP False → High Value Check
      {
        id: 'e-vip-false',
        source: 'if-vip',
        target: 'if-high-value',
        sourceHandle: 'false_output',
      },

      // High Value branches
      {
        id: 'e-high-true',
        source: 'if-high-value',
        target: 'template-high-value',
        sourceHandle: 'true_output',
      },
      {
        id: 'e-high-false',
        source: 'if-high-value',
        target: 'template-standard',
        sourceHandle: 'false_output',
      },
    ],
    metadata: {
      name: 'E-Commerce Order Processing',
      description:
        'Comprehensive flow demonstrating multi-input, JQ transforms, nested conditionals, templates, and AI integration',
      created: new Date().toISOString(),
    },
  };
}

/**
 * Simple AI Chat Flow
 *
 * Demonstrates basic AI model integration:
 *   Input (topic) → Template (prompt) → Model (AI response)
 */
function buildAiChatFlow(): FlowlibDefinition {
  return {
    nodes: [
      {
        id: 'input-topic',
        type: 'trigger.manual',
        label: 'Topic',
        referenceId: 'topic',
        params: {
          variableName: 'topic',
          defaultValue: 'the benefits of renewable energy',
        },
        position: { x: 100, y: 200 },
      },
      {
        id: 'template-prompt',
        type: 'core.template_string',
        label: 'Build Prompt',
        referenceId: 'prompt',
        params: {
          template: 'Write a concise, informative paragraph (3-4 sentences) about: {{ topic }}',
        },
        position: { x: 400, y: 200 },
      },
      {
        id: 'model-response',
        type: 'core.model',
        label: 'AI Response',
        referenceId: 'response',
        params: {
          provider: 'ANTHROPIC',
          model: 'claude-3-haiku-20240307',
          credentialId: '', // Will be filled if credential exists
          prompt: '{{ prompt }}',
          systemPrompt: 'You are a helpful assistant. Provide clear, accurate information.',
          maxTokens: 300,
        },
        position: { x: 700, y: 200 },
      },
    ],
    edges: [
      { id: 'e-topic-prompt', source: 'input-topic', target: 'template-prompt' },
      { id: 'e-prompt-model', source: 'template-prompt', target: 'model-response' },
    ],
    metadata: {
      name: 'AI Chat Flow',
      description: 'Simple Input → Template → AI Model flow for generating responses',
      created: new Date().toISOString(),
    },
  };
}

/**
 * Comprehensive Multi-Stage Flow
 *
 * Tests ALL node types with complex, realistic logic:
 *
 * Flow structure:
 *   Input (user_request)
 *       ↓
 *   HTTP Request (fetch user profile from API)
 *       ↓
 *   JQ (extract user data + determine tier)
 *       ↓
 *   If-Else (premium user?)
 *      ↓ True                    ↓ False
 *   Template (premium prompt)    Template (basic prompt)
 *      ↓                              ↓
 *   Model (detailed analysis)   Model (brief summary)
 *      ↓                              ↓
 *   JQ (format premium)         JQ (format basic)
 *      └──────────┬───────────────────┘
 *                 ↓
 *   Template (combine results)
 *       ↓
 *   Model (final polish/review)
 *       ↓
 *   Output (final result)
 *
 * @param credentialId - AI credential ID for Model nodes
 * @param isPremiumUser - Whether to simulate a premium user
 */
function buildComprehensiveMultiStageFlow(
  credentialId: string,
  isPremiumUser: boolean,
): FlowlibDefinition {
  const modelName = 'claude-3-haiku-20240307';

  // Simulate user data that would come from an API
  const mockUserData = {
    userId: isPremiumUser ? 'user_premium_123' : 'user_basic_456',
    name: isPremiumUser ? 'Alice Premium' : 'Bob Basic',
    tier: isPremiumUser ? 'premium' : 'basic',
    credits: isPremiumUser ? 1000 : 10,
    preferences: {
      language: 'en',
      detailLevel: isPremiumUser ? 'comprehensive' : 'brief',
    },
  };

  return {
    nodes: [
      // STAGE 1: Input Collection
      {
        id: 'input-request',
        type: 'trigger.manual',
        label: 'User Request',
        referenceId: 'user_request',
        params: {
          variableName: 'request',
          defaultValue: JSON.stringify({
            topic: 'artificial intelligence in healthcare',
            analysisType: 'trends',
          }),
        },
        position: { x: 100, y: 300 },
      },

      // STAGE 2: Fetch User Profile via HTTP
      {
        id: 'http-fetch-user',
        type: 'http.request',
        label: 'Fetch User Profile',
        referenceId: 'user_profile_response',
        params: {
          method: 'POST',
          url: 'https://httpbin.org/post',
          body: JSON.stringify(mockUserData),
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': 'seed-comprehensive-flow',
          },
        },
        position: { x: 300, y: 300 },
      },

      // STAGE 3: Extract & Transform User Data
      {
        id: 'jq-extract-user',
        type: 'core.jq',
        label: 'Extract User Data',
        referenceId: 'user_data',
        params: {
          query: `.user_profile_response.data.json | {
            userId: .userId,
            name: .name,
            tier: .tier,
            credits: .credits,
            isPremium: (.tier == "premium"),
            detailLevel: .preferences.detailLevel
          }`,
        },
        position: { x: 500, y: 300 },
      },

      // STAGE 4: Branch on User Tier
      {
        id: 'if-premium',
        type: 'core.if_else',
        label: 'Is Premium User?',
        referenceId: 'tier_check',
        params: {
          condition: { '==': [{ var: 'user_data.isPremium' }, true] },
        },
        position: { x: 700, y: 300 },
      },

      // STAGE 5A: Premium Branch
      {
        id: 'template-premium-prompt',
        type: 'core.template_string',
        label: 'Premium Prompt',
        referenceId: 'premium_prompt',
        params: {
          template: `You are providing a PREMIUM analysis for {{ tier_check.user_data.name }}.

Topic: {{ user_request.topic }}
Analysis Type: {{ user_request.analysisType }}
Detail Level: {{ tier_check.user_data.detailLevel }}

Please provide a comprehensive analysis including:
1. Executive Summary
2. Current State Analysis
3. Key Trends and Developments
4. Future Predictions
5. Recommendations

Be thorough and detailed - this is for a premium subscriber with {{ tier_check.user_data.credits }} credits.`,
        },
        position: { x: 900, y: 150 },
      },

      {
        id: 'model-premium-analysis',
        type: 'core.model',
        label: 'Premium AI Analysis',
        referenceId: 'premium_analysis',
        params: {
          credentialId: credentialId,
          model: modelName,
          prompt: '{{ premium_prompt }}',
          systemPrompt:
            'You are an expert analyst providing premium-tier, comprehensive research reports. Be detailed and thorough.',
          temperature: 0.7,
          maxTokens: 800,
        },
        position: { x: 1100, y: 150 },
      },

      {
        id: 'jq-format-premium',
        type: 'core.jq',
        label: 'Format Premium Result',
        referenceId: 'formatted_premium',
        params: {
          query: `{
            tier: "premium",
            userName: .tier_check.user_data.name,
            analysis: .premium_analysis,
            wordCount: (.premium_analysis | tostring | split(" ") | length),
            quality: "comprehensive"
          }`,
        },
        position: { x: 1300, y: 150 },
      },

      // STAGE 5B: Basic Branch
      {
        id: 'template-basic-prompt',
        type: 'core.template_string',
        label: 'Basic Prompt',
        referenceId: 'basic_prompt',
        params: {
          template: `Provide a brief summary for {{ tier_check.user_data.name }}.

Topic: {{ user_request.topic }}

Give a concise 2-3 sentence overview. Keep it simple - this user has limited credits ({{ tier_check.user_data.credits }}).`,
        },
        position: { x: 900, y: 450 },
      },

      {
        id: 'model-basic-summary',
        type: 'core.model',
        label: 'Basic AI Summary',
        referenceId: 'basic_summary',
        params: {
          credentialId: credentialId,
          model: modelName,
          prompt: '{{ basic_prompt }}',
          systemPrompt:
            'You are a helpful assistant providing brief, easy-to-understand summaries. Be concise.',
          temperature: 0.5,
          maxTokens: 200,
        },
        position: { x: 1100, y: 450 },
      },

      {
        id: 'jq-format-basic',
        type: 'core.jq',
        label: 'Format Basic Result',
        referenceId: 'formatted_basic',
        params: {
          query: `{
            tier: "basic",
            userName: .tier_check.user_data.name,
            analysis: .basic_summary,
            wordCount: (.basic_summary | tostring | split(" ") | length),
            quality: "brief"
          }`,
        },
        position: { x: 1300, y: 450 },
      },

      // STAGE 6: Merge & Final Processing
      {
        id: 'template-final-combine',
        type: 'core.template_string',
        label: 'Combine Results',
        referenceId: 'combined_result',
        params: {
          template: `{% if formatted_premium %}
PREMIUM REPORT
==============
User: {{ formatted_premium.userName }}
Quality: {{ formatted_premium.quality }}
Word Count: {{ formatted_premium.wordCount }}

{{ formatted_premium.analysis }}
{% elif formatted_basic %}
BASIC SUMMARY
=============
User: {{ formatted_basic.userName }}
Quality: {{ formatted_basic.quality }}
Word Count: {{ formatted_basic.wordCount }}

{{ formatted_basic.analysis }}
{% endif %}

---
Generated by Flowlib`,
        },
        position: { x: 1500, y: 300 },
      },

      // STAGE 7: Final Polish
      {
        id: 'model-final-polish',
        type: 'core.model',
        label: 'Final Polish',
        referenceId: 'polished_result',
        params: {
          credentialId: credentialId,
          model: modelName,
          prompt: `Review and add a brief closing thought to this report. Keep the original content but add a 1-2 sentence professional closing:

{{ combined_result }}`,
          systemPrompt:
            'You are an editor adding a professional touch to reports. Add a brief, insightful closing thought.',
          temperature: 0.6,
          maxTokens: 400,
        },
        position: { x: 1700, y: 300 },
      },

      // STAGE 8: Final Output
      {
        id: 'output-final',
        type: 'core.output',
        label: 'Final Report',
        referenceId: 'final_report',
        params: {
          outputValue: '{{ polished_result }}',
          outputName: 'report',
        },
        position: { x: 1900, y: 300 },
      },
    ],
    edges: [
      // Input → HTTP
      { id: 'edge-input-to-http', source: 'input-request', target: 'http-fetch-user' },
      // HTTP → JQ Extract
      { id: 'edge-http-to-jq', source: 'http-fetch-user', target: 'jq-extract-user' },
      // JQ Extract → If-Else
      { id: 'edge-jq-to-ifelse', source: 'jq-extract-user', target: 'if-premium' },

      // Premium Branch
      {
        id: 'edge-ifelse-to-premium-template',
        source: 'if-premium',
        target: 'template-premium-prompt',
        sourceHandle: 'true_output',
      },
      {
        id: 'edge-premium-template-to-model',
        source: 'template-premium-prompt',
        target: 'model-premium-analysis',
      },
      {
        id: 'edge-premium-model-to-jq',
        source: 'model-premium-analysis',
        target: 'jq-format-premium',
      },
      {
        id: 'edge-premium-jq-to-combine',
        source: 'jq-format-premium',
        target: 'template-final-combine',
      },

      // Basic Branch
      {
        id: 'edge-ifelse-to-basic-template',
        source: 'if-premium',
        target: 'template-basic-prompt',
        sourceHandle: 'false_output',
      },
      {
        id: 'edge-basic-template-to-model',
        source: 'template-basic-prompt',
        target: 'model-basic-summary',
      },
      { id: 'edge-basic-model-to-jq', source: 'model-basic-summary', target: 'jq-format-basic' },
      {
        id: 'edge-basic-jq-to-combine',
        source: 'jq-format-basic',
        target: 'template-final-combine',
      },

      // Final Stage
      {
        id: 'edge-combine-to-polish',
        source: 'template-final-combine',
        target: 'model-final-polish',
      },
      { id: 'edge-polish-to-output', source: 'model-final-polish', target: 'output-final' },
    ],
    metadata: {
      name: isPremiumUser ? 'Comprehensive Flow (Premium)' : 'Comprehensive Flow (Basic)',
      description: 'Full multi-stage flow: HTTP→JQ→If-Else→Model(x2)→Output with branching',
      created: new Date().toISOString(),
    },
  };
}

/**
 * Operations Escalation Matrix
 *
 * Rich non-AI flow for dashboard/editor testing.
 * Combines two inputs, normalization, nested branching, templates, and a final output.
 */
function buildOperationsEscalationFlow(): FlowlibDefinition {
  const incidentPayload = {
    incidentId: 'INC-2048',
    service: 'billing-api',
    priority: 'P1',
    status: 'investigating',
    impactedCustomers: 124,
    suspectedRootCause: 'regional database failover lag',
    regions: ['us-east-1', 'eu-west-1'],
  };

  const accountContext = {
    accountName: 'Northstar Health',
    tier: 'enterprise',
    arr: 420000,
    csm: 'Jamie Rivera',
    slackChannel: '#ops-northstar-health',
  };

  return {
    nodes: [
      {
        id: 'input-incident',
        type: 'trigger.manual',
        label: 'Incident Payload',
        referenceId: 'incident',
        params: {
          variableName: 'incident',
          defaultValue: JSON.stringify(incidentPayload),
        },
        position: { x: 40, y: 120 },
      },
      {
        id: 'input-account',
        type: 'trigger.manual',
        label: 'Account Context',
        referenceId: 'account',
        params: {
          variableName: 'account',
          defaultValue: JSON.stringify(accountContext),
        },
        position: { x: 40, y: 320 },
      },
      {
        id: 'jq-normalize-incident',
        type: 'core.jq',
        label: 'Normalize Context',
        referenceId: 'incident_context',
        params: {
          query: `{
  incidentId: .incident.incidentId,
  service: .incident.service,
  priority: .incident.priority,
  status: .incident.status,
  impactedCustomers: .incident.impactedCustomers,
  accountName: .account.accountName,
  tier: .account.tier,
  arr: .account.arr,
  csm: .account.csm,
  slackChannel: .account.slackChannel,
  severityScore: ((if .incident.priority == "P1" then 70 else 30 end) + (.incident.impactedCustomers / 2)),
  needsExecutiveUpdate: (.account.tier == "enterprise" and .incident.priority == "P1"),
  requiresHotfix: (.incident.priority == "P1" or .incident.impactedCustomers > 100)
}`,
        },
        position: { x: 320, y: 220 },
      },
      {
        id: 'if-executive-update',
        type: 'core.if_else',
        label: 'Executive Update Required?',
        referenceId: 'executive_check',
        params: {
          condition: { '==': [{ var: 'incident_context.needsExecutiveUpdate' }, true] },
        },
        position: { x: 620, y: 220 },
      },
      {
        id: 'template-executive-brief',
        type: 'core.template_string',
        label: 'Executive Brief',
        referenceId: 'executive_brief',
        params: {
          template: `Executive Update\n\n{{ executive_check.incident_context.accountName }} has a {{ executive_check.incident_context.priority }} incident on {{ executive_check.incident_context.service }} impacting {{ executive_check.incident_context.impactedCustomers }} customers. Severity score: {{ executive_check.incident_context.severityScore }}. Coordinate with {{ executive_check.incident_context.csm }} in {{ executive_check.incident_context.slackChannel }}.`,
        },
        position: { x: 940, y: 70 },
      },
      {
        id: 'if-hotfix',
        type: 'core.if_else',
        label: 'Hotfix Required?',
        referenceId: 'hotfix_check',
        params: {
          condition: { '==': [{ var: 'executive_check.incident_context.requiresHotfix' }, true] },
        },
        position: { x: 940, y: 320 },
      },
      {
        id: 'template-hotfix-plan',
        type: 'core.template_string',
        label: 'Hotfix Plan',
        referenceId: 'hotfix_plan',
        params: {
          template: `Hotfix Plan\n\nPrepare rollback and patch validation for {{ hotfix_check.executive_check.incident_context.service }}. Notify {{ hotfix_check.executive_check.incident_context.csm }} and keep {{ hotfix_check.executive_check.incident_context.slackChannel }} updated every 15 minutes.`,
        },
        position: { x: 1240, y: 220 },
      },
      {
        id: 'template-monitoring-plan',
        type: 'core.template_string',
        label: 'Monitoring Plan',
        referenceId: 'monitoring_plan',
        params: {
          template: `Monitoring Plan\n\nContinue observing {{ hotfix_check.executive_check.incident_context.service }} and post status updates in {{ hotfix_check.executive_check.incident_context.slackChannel }} until customer impact drops below threshold.`,
        },
        position: { x: 1240, y: 430 },
      },
      {
        id: 'output-dispatch-summary',
        type: 'core.output',
        label: 'Dispatch Summary',
        referenceId: 'dispatch_summary',
        params: {
          outputName: 'dispatch_summary',
          outputValue: `{% if executive_brief %}{{ executive_brief }}{% elif hotfix_plan %}{{ hotfix_plan }}{% else %}{{ monitoring_plan }}{% endif %}`,
        },
        position: { x: 1540, y: 290 },
      },
    ],
    edges: [
      { id: 'ops-incident-normalize', source: 'input-incident', target: 'jq-normalize-incident' },
      { id: 'ops-account-normalize', source: 'input-account', target: 'jq-normalize-incident' },
      { id: 'ops-normalize-exec', source: 'jq-normalize-incident', target: 'if-executive-update' },
      {
        id: 'ops-exec-true',
        source: 'if-executive-update',
        target: 'template-executive-brief',
        sourceHandle: 'true_output',
      },
      {
        id: 'ops-exec-false',
        source: 'if-executive-update',
        target: 'if-hotfix',
        sourceHandle: 'false_output',
      },
      {
        id: 'ops-hotfix-true',
        source: 'if-hotfix',
        target: 'template-hotfix-plan',
        sourceHandle: 'true_output',
      },
      {
        id: 'ops-hotfix-false',
        source: 'if-hotfix',
        target: 'template-monitoring-plan',
        sourceHandle: 'false_output',
      },
      {
        id: 'ops-brief-output',
        source: 'template-executive-brief',
        target: 'output-dispatch-summary',
      },
      {
        id: 'ops-hotfix-output',
        source: 'template-hotfix-plan',
        target: 'output-dispatch-summary',
      },
      {
        id: 'ops-monitor-output',
        source: 'template-monitoring-plan',
        target: 'output-dispatch-summary',
      },
    ],
    metadata: {
      name: 'Operations Escalation Matrix',
      description:
        'Non-AI incident escalation flow with multi-input normalization, nested branching, templates, and final dispatch output.',
      created: new Date().toISOString(),
      tags: ['ops', 'incident', 'branching', 'jq', 'templates'],
    },
  };
}

/**
 * Architecture Drawing Styles Discovery Flow (with Data Mapper)
 *
 * This complex flow demonstrates the data mapper feature by:
 * 1. Starting with a list of famous conceptual architecture drawings
 * 2. Iterating over each to analyze its visual style characteristics
 * 3. Categorizing styles using AI analysis
 * 4. Aggregating results into a comprehensive style taxonomy
 * 5. Generating a comparative analysis report
 *
 * Flow structure:
 *   Input (Drawings List)
 *       ↓
 *   JQ (Parse & Enrich)
 *       ↓
 *   🔄 Template (Mapper: Build Analysis Prompts) ───────────┐
 *       ↓                                                   │
 *   🔄 Model (Mapper: Analyze Each Drawing Style)           │ Iterate over
 *       ↓                                                   │ drawings array
 *   🔄 JQ (Mapper: Extract Style Features)  ────────────────┘
 *       ↓
 *   JQ (Aggregate All Styles)
 *       ↓
 *   Template (Build Taxonomy Prompt)
 *       ↓
 *   Model (Generate Style Taxonomy)
 *       ↓
 *   JQ (Structure Final Results)
 *       ↓
 *   If-Else (Has enough variety?)
 *      ↓ True              ↓ False
 *   Template              Template
 *   (Rich Report)        (Limited Report)
 *       ↓                     ↓
 *       └──────────┬──────────┘
 *                  ↓
 *   Model (Final Comparative Analysis)
 *       ↓
 *   Output (Style Guide)
 */
function buildArchitectureStylesFlow(credentialId: string): FlowlibDefinition {
  // Famous conceptual architecture drawings and their sources
  const drawingsList = {
    drawings: [
      {
        id: 'superstudio-continuous-monument',
        title: 'The Continuous Monument',
        architect: 'Superstudio',
        year: 1969,
        movement: 'Radical Architecture',
        medium: 'Photomontage, collage',
        description: 'Dystopian grid structure superimposed on natural landscapes',
        characteristics: [
          'geometric precision',
          'surreal scale',
          'photorealistic backgrounds',
          'minimal palette',
        ],
      },
      {
        id: 'archigram-walking-city',
        title: 'Walking City',
        architect: 'Archigram (Ron Herron)',
        year: 1964,
        movement: 'High-Tech Utopia',
        medium: 'Ink, collage, mixed media',
        description: 'Massive mobile robotic structures traversing landscapes',
        characteristics: [
          'pop art colors',
          'mechanical details',
          'comic book style',
          'dynamic composition',
        ],
      },
      {
        id: 'piranesi-carceri',
        title: "Carceri d'Invenzione (Imaginary Prisons)",
        architect: 'Giovanni Battista Piranesi',
        year: 1761,
        movement: 'Capriccio',
        medium: 'Etching',
        description: 'Impossible prison interiors with endless staircases and machinery',
        characteristics: [
          'dramatic chiaroscuro',
          'infinite perspective',
          'architectural impossibility',
          'romantic darkness',
        ],
      },
      {
        id: 'lebbeus-woods-war-zones',
        title: 'War and Architecture',
        architect: 'Lebbeus Woods',
        year: 1993,
        movement: 'Deconstructivism',
        medium: 'Graphite, ink on paper',
        description: 'Parasitic structures emerging from war-damaged buildings',
        characteristics: [
          'aggressive angles',
          'dense linework',
          'fragmentation',
          'tectonic tension',
        ],
      },
      {
        id: 'zaha-hadid-peak',
        title: 'The Peak Leisure Club',
        architect: 'Zaha Hadid',
        year: 1983,
        movement: 'Deconstructivism',
        medium: 'Acrylic on canvas',
        description: 'Fragmented horizontal layers embedded in Hong Kong hillside',
        characteristics: [
          'exploded axonometric',
          'dynamic fragmentation',
          'bold colors',
          'suprematist influence',
        ],
      },
      {
        id: 'cedric-price-fun-palace',
        title: 'Fun Palace',
        architect: 'Cedric Price',
        year: 1961,
        movement: 'Systems Architecture',
        medium: 'Technical drawing, axonometric',
        description: 'Flexible, adaptable cultural center with movable components',
        characteristics: [
          'diagrammatic clarity',
          'systems thinking',
          'temporal notation',
          'industrial aesthetic',
        ],
      },
      {
        id: 'sant-elia-citta-nuova',
        title: 'La Città Nuova',
        architect: "Antonio Sant'Elia",
        year: 1914,
        movement: 'Futurism',
        medium: 'Ink and watercolor',
        description: 'Visionary city with multi-level transportation and towers',
        characteristics: [
          'dynamic perspective',
          'streamlined forms',
          'verticality',
          'kinetic energy',
        ],
      },
      {
        id: 'constant-new-babylon',
        title: 'New Babylon',
        architect: 'Constant Nieuwenhuys',
        year: 1959,
        movement: 'Situationism',
        medium: 'Mixed media, models, paintings',
        description: 'Nomadic city of interconnected sectors for perpetual play',
        characteristics: [
          'labyrinthine complexity',
          'psychedelic colors',
          'network diagrams',
          'social mapping',
        ],
      },
    ],
    analysisGoals: [
      'Identify dominant rendering techniques',
      'Classify by representational approach (abstract vs figurative)',
      'Map influence relationships between styles',
      'Extract color palette patterns',
      'Analyze compositional strategies',
    ],
  };

  return {
    nodes: [
      // ============ STAGE 1: INPUT ============
      {
        id: 'input-drawings',
        type: 'trigger.manual',
        label: 'Architecture Drawings Collection',
        referenceId: 'drawings_input',
        params: {
          variableName: 'collection',
          defaultValue: JSON.stringify(drawingsList),
        },
        position: { x: 50, y: 300 },
      },

      // ============ STAGE 2: PARSE & ENRICH ============
      {
        id: 'jq-parse-collection',
        type: 'core.jq',
        label: 'Parse Collection',
        referenceId: 'parsed_collection',
        params: {
          query: `.drawings_input | {
  drawings: .drawings,
  goals: .analysisGoals,
  totalCount: (.drawings | length),
  movements: [.drawings[].movement] | unique,
  timespan: {
    earliest: ([.drawings[].year] | min),
    latest: ([.drawings[].year] | max)
  }
}`,
        },
        position: { x: 250, y: 300 },
      },

      // ============ STAGE 3: ITERATE - Build Analysis Prompts ============
      {
        id: 'template-analysis-prompt',
        type: 'core.template_string',
        label: '🔄 Build Analysis Prompt',
        referenceId: 'analysis_prompt',
        mapper: {
          enabled: true,
          expression: 'parsed_collection.drawings',
          mode: 'iterate' as const,
          outputMode: 'array' as const,
          concurrency: 1,
          onEmpty: 'skip' as const,
        },
        params: {
          template: `Analyze the drawing style of "{{ title }}" ({{ year }}) by {{ architect }}.

Movement: {{ movement }}
Medium: {{ medium }}
Description: {{ description }}
Known characteristics: {{ characteristics | join(", ") }}

Provide a detailed analysis covering:
1. RENDERING TECHNIQUE: How is space and form represented? (line weight, hatching, shading, color use)
2. COMPOSITIONAL STRATEGY: How is the image organized? (perspective type, framing, focal points)
3. REPRESENTATIONAL APPROACH: Where does it fall on abstract-to-figurative spectrum?
4. EMOTIONAL TONE: What mood/atmosphere does the drawing convey?
5. INFLUENCE MARKERS: What artistic movements or predecessors are evident?

Format your response as JSON with these exact keys:
{
  "renderingTechnique": { "primary": "...", "secondary": ["..."], "description": "..." },
  "composition": { "perspectiveType": "...", "framing": "...", "dynamism": "low|medium|high" },
  "abstraction": { "level": 1-10, "approach": "..." },
  "emotionalTone": { "primary": "...", "keywords": ["..."] },
  "influences": { "movements": ["..."], "artists": ["..."] }
}`,
        },
        position: { x: 500, y: 200 },
      },

      // ============ STAGE 4: AI Style Analysis ============
      {
        id: 'model-analyze-style',
        type: 'core.model',
        label: '🔄 Analyze Drawing Style',
        referenceId: 'style_analysis',
        mapper: {
          enabled: true,
          expression: 'analysis_prompt',
          mode: 'iterate' as const,
          outputMode: 'array' as const,
          concurrency: 1,
          onEmpty: 'skip' as const,
        },
        params: {
          provider: 'ANTHROPIC',
          credentialId: credentialId,
          model: 'claude-3-haiku-20240307',
          prompt: '{{ item }}',
          systemPrompt: `You are an expert in architectural representation, drawing techniques, and visual analysis. 
You have deep knowledge of:
- Historical and contemporary architectural rendering methods
- Art movements that influenced architectural visualization
- Technical aspects of various media (ink, graphite, watercolor, digital, collage)
- Compositional theory and visual communication

Analyze drawings with precision and scholarly depth. Always respond with valid JSON.`,
          temperature: 0.3,
          maxTokens: 1000,
        },
        position: { x: 750, y: 200 },
      },

      // ============ STAGE 5: Extract Features ============
      {
        id: 'jq-extract-features',
        type: 'core.jq',
        label: '🔄 Extract Style Features',
        referenceId: 'extracted_features',
        mapper: {
          enabled: true,
          expression: 'style_analysis',
          mode: 'iterate' as const,
          outputMode: 'array' as const,
          concurrency: 1,
          onEmpty: 'skip' as const,
        },
        params: {
          query: `{
  analysis: (
    if (.item | type) == "string" then
      (.item | try fromjson catch { "error": "parse_failed", "raw": .item })
    else
      .item
    end
  ),
  drawing: .parsed_collection.drawings[._item.index]
}`,
        },
        position: { x: 1000, y: 200 },
      },

      // ============ STAGE 6: AGGREGATE ALL STYLES ============
      {
        id: 'jq-aggregate-styles',
        type: 'core.jq',
        label: 'Aggregate Style Data',
        referenceId: 'aggregated_styles',
        params: {
          query: `{
  totalAnalyzed: (.extracted_features | length),
  byMovement: (
    [.extracted_features[] | {movement: .drawing.movement, title: .drawing.title, analysis: .analysis}] 
    | group_by(.movement) 
    | map({
        movement: .[0].movement,
        count: length,
        drawings: [.[] | .title],
        commonTechniques: [.[] | .analysis.renderingTechnique.primary // "unknown"] | unique
      })
  ),
  abstractionSpectrum: (
    [.extracted_features[] | {title: .drawing.title, level: (.analysis.abstraction.level // 5)}] 
    | sort_by(.level)
  ),
  emotionalPalette: (
    [.extracted_features[].analysis.emotionalTone.primary // "undefined"] 
    | unique
  ),
  influenceNetwork: (
    [.extracted_features[].analysis.influences.movements // []] 
    | flatten 
    | group_by(.) 
    | map({influence: .[0], frequency: length}) 
    | sort_by(-.frequency)
    | .[0:10]
  ),
  timelineData: (
    [.extracted_features[] | {year: .drawing.year, title: .drawing.title, movement: .drawing.movement}] 
    | sort_by(.year)
  ),
  rawFeatures: .extracted_features
}`,
        },
        position: { x: 1250, y: 300 },
      },

      // ============ STAGE 7: BUILD TAXONOMY PROMPT ============
      {
        id: 'template-taxonomy-prompt',
        type: 'core.template_string',
        label: 'Build Taxonomy Prompt',
        referenceId: 'taxonomy_prompt',
        params: {
          template: `Based on the following analyzed architectural drawing styles, create a comprehensive taxonomy of conceptual architecture visualization techniques.

ANALYZED DATA:
- Total drawings analyzed: {{ aggregated_styles.totalAnalyzed }}
- Movements represented: {% for m in aggregated_styles.byMovement %}{{ m.movement }}{% if not loop.last %}, {% endif %}{% endfor %}
- Abstraction range: {% set firstAbstract = aggregated_styles.abstractionSpectrum | first %}{% set lastAbstract = aggregated_styles.abstractionSpectrum | last %}{{ firstAbstract.title }} (most concrete) to {{ lastAbstract.title }} (most abstract)
- Emotional tones found: {{ aggregated_styles.emotionalPalette | join(", ") }}
- Top influences: {% for inf in aggregated_styles.influenceNetwork | slice(0, 5) %}{{ inf.influence }} ({{ inf.frequency }}){% if not loop.last %}, {% endif %}{% endfor %}

TIMELINE:
{% for item in aggregated_styles.timelineData %}
- {{ item.year }}: "{{ item.title }}" ({{ item.movement }})
{% endfor %}

MOVEMENT BREAKDOWN:
{% for m in aggregated_styles.byMovement %}
{{ m.movement }} ({{ m.count }} works):
  - Drawings: {{ m.drawings | join(", ") }}
  - Common techniques: {{ m.commonTechniques | join(", ") }}
{% endfor %}

Please create a structured taxonomy that:
1. Identifies 4-6 major STYLE CATEGORIES based on visual approach
2. Maps each analyzed drawing to its category
3. Describes the key characteristics of each category
4. Notes evolution patterns across the timeline
5. Highlights unexpected connections between movements

Format as JSON:
{
  "taxonomy": {
    "categories": [
      {
        "name": "Category Name",
        "description": "...",
        "keyCharacteristics": ["..."],
        "exampleDrawings": ["..."],
        "historicalPeriod": "..."
      }
    ],
    "evolutionNarrative": "...",
    "crossInfluences": [{"from": "...", "to": "...", "connection": "..."}]
  }
}`,
        },
        position: { x: 1500, y: 300 },
      },

      // ============ STAGE 8: GENERATE TAXONOMY ============
      {
        id: 'model-generate-taxonomy',
        type: 'core.model',
        label: 'Generate Style Taxonomy',
        referenceId: 'style_taxonomy',
        params: {
          provider: 'ANTHROPIC',
          credentialId: credentialId,
          model: 'claude-3-haiku-20240307',
          prompt: '{{ taxonomy_prompt }}',
          systemPrompt: `You are a leading scholar in architectural history and visual culture, specializing in the evolution of architectural representation from Piranesi to contemporary digital practices.

Your expertise includes:
- The relationship between drawing technique and architectural ideology
- How visualization methods reflect cultural and technological contexts
- The interplay between fine art movements and architectural graphics
- The semiotics of architectural representation

Create insightful, academically rigorous taxonomies. Always respond with valid JSON.`,
          temperature: 0.4,
          maxTokens: 2000,
        },
        position: { x: 1750, y: 300 },
      },

      // ============ STAGE 9: STRUCTURE RESULTS ============
      {
        id: 'jq-structure-results',
        type: 'core.jq',
        label: 'Structure Final Results',
        referenceId: 'structured_results',
        params: {
          query: `{
  meta: {
    analyzedCount: .aggregated_styles.totalAnalyzed,
    movementsCount: (.aggregated_styles.byMovement | length),
    generatedAt: now | todate
  },
  taxonomy: (
    if (.style_taxonomy | type) == "string" then
      (.style_taxonomy | try fromjson catch {})
    else
      .style_taxonomy
    end
  ),
  aggregatedData: .aggregated_styles,
  hasRichData: ((.aggregated_styles.totalAnalyzed >= 5) and ((.aggregated_styles.byMovement | length) >= 3))
}`,
        },
        position: { x: 2000, y: 300 },
      },

      // ============ STAGE 10: VARIETY CHECK ============
      {
        id: 'if-variety-check',
        type: 'core.if_else',
        label: 'Has Rich Variety?',
        referenceId: 'variety_check',
        params: {
          condition: { '==': [{ var: 'structured_results.hasRichData' }, true] },
        },
        position: { x: 2250, y: 300 },
      },

      // ============ STAGE 11a: RICH REPORT TEMPLATE ============
      {
        id: 'template-rich-report',
        type: 'core.template_string',
        label: 'Rich Report Template',
        referenceId: 'rich_report',
        params: {
          template: `# Comprehensive Guide to Conceptual Architecture Drawing Styles

## Executive Summary
{% set firstTimeline = variety_check.structured_results.aggregatedData.timelineData | first %}{% set lastTimeline = variety_check.structured_results.aggregatedData.timelineData | last %}This analysis examined {{ variety_check.structured_results.meta.analyzedCount }} seminal works of conceptual architecture spanning {{ firstTimeline.year }} to {{ lastTimeline.year }}.

## Style Taxonomy
{% if variety_check.structured_results.taxonomy.taxonomy %}
{% for category in variety_check.structured_results.taxonomy.taxonomy.categories %}
### {{ category.name }}
{{ category.description }}

**Key Characteristics:**
{% for char in category.keyCharacteristics %}- {{ char }}
{% endfor %}

**Representative Works:** {{ category.exampleDrawings | join(", ") }}
**Historical Period:** {{ category.historicalPeriod }}

{% endfor %}
{% endif %}

## Evolution Narrative
{{ variety_check.structured_results.taxonomy.taxonomy.evolutionNarrative | default("Analysis pending...") }}

## Cross-Movement Influences
{% if variety_check.structured_results.taxonomy.taxonomy.crossInfluences %}
{% for inf in variety_check.structured_results.taxonomy.taxonomy.crossInfluences %}
- **{{ inf.from }}** → **{{ inf.to }}**: {{ inf.connection }}
{% endfor %}
{% endif %}

## Movement Analysis
{% for m in variety_check.structured_results.aggregatedData.byMovement %}
### {{ m.movement }}
- **Works analyzed:** {{ m.count }}
- **Drawings:** {{ m.drawings | join(", ") }}
- **Common techniques:** {{ m.commonTechniques | join(", ") }}
{% endfor %}

## Abstraction Spectrum
From most concrete to most abstract:
{% for item in variety_check.structured_results.aggregatedData.abstractionSpectrum %}
{{ loop.index }}. {{ item.title }} (Level: {{ item.level }}/10)
{% endfor %}

---
*Generated: {{ variety_check.structured_results.meta.generatedAt }}*`,
        },
        position: { x: 2500, y: 150 },
      },

      // ============ STAGE 11b: LIMITED REPORT TEMPLATE ============
      {
        id: 'template-limited-report',
        type: 'core.template_string',
        label: 'Limited Report Template',
        referenceId: 'limited_report',
        params: {
          template: `# Architecture Drawing Styles - Preliminary Analysis

**Note:** This analysis is based on a limited dataset ({{ variety_check.structured_results.meta.analyzedCount }} works, {{ variety_check.structured_results.meta.movementsCount }} movements). Additional examples recommended for comprehensive taxonomy.

## Available Data Summary

### Movements Covered
{% for m in variety_check.structured_results.aggregatedData.byMovement %}
- {{ m.movement }}: {{ m.count }} work(s)
{% endfor %}

### Initial Observations
{% if variety_check.structured_results.taxonomy.taxonomy %}
{{ variety_check.structured_results.taxonomy.taxonomy.evolutionNarrative | default("Insufficient data for evolution analysis.") }}
{% else %}
Taxonomy generation requires additional data points.
{% endif %}

### Emotional Range Detected
{{ variety_check.structured_results.aggregatedData.emotionalPalette | join(", ") }}

---
*Preliminary report - expand dataset for full analysis*`,
        },
        position: { x: 2500, y: 450 },
      },

      // ============ STAGE 12: FINAL COMPARATIVE ANALYSIS ============
      {
        id: 'model-comparative-analysis',
        type: 'core.model',
        label: 'Final Comparative Analysis',
        referenceId: 'comparative_analysis',
        params: {
          provider: 'ANTHROPIC',
          credentialId: credentialId,
          model: 'claude-3-haiku-20240307',
          prompt: `Review and enhance this architectural drawing style guide:

{{ rich_report }}{{ limited_report }}

Please add:
1. A compelling introduction for architecture students and practitioners
2. Practical insights: How can contemporary architects learn from these historical visualization techniques?
3. A brief section on how digital tools have evolved these traditions
4. 3-5 specific recommendations for which style to study for different architectural communication goals

Keep the existing content but weave in these enhancements naturally. Maintain academic rigor while being accessible.`,
          systemPrompt:
            'You are editing an academic report on architectural visualization. Enhance it while preserving the structured data and analysis. Add pedagogical value for architecture students.',
          temperature: 0.5,
          maxTokens: 3000,
        },
        position: { x: 2750, y: 300 },
      },

      // ============ STAGE 13: OUTPUT ============
      {
        id: 'output-style-guide',
        type: 'core.output',
        label: 'Architecture Style Guide',
        referenceId: 'style_guide',
        params: {
          outputValue: '{{ comparative_analysis }}',
          outputName: 'architecture_drawing_style_guide',
        },
        position: { x: 3000, y: 300 },
      },
    ],
    edges: [
      // Input → Parse
      { id: 'edge-input-to-parse', source: 'input-drawings', target: 'jq-parse-collection' },

      // Parse → Mapper (Analysis Prompts)
      {
        id: 'edge-parse-to-prompt-loop',
        source: 'jq-parse-collection',
        target: 'template-analysis-prompt',
      },

      // Prompt Mapper → Model Mapper (model iterates over the prompt array)
      {
        id: 'edge-prompt-to-model',
        source: 'template-analysis-prompt',
        target: 'model-analyze-style',
      },

      // Model Mapper → Extract Mapper (extract iterates over the analysis array)
      { id: 'edge-model-to-extract', source: 'model-analyze-style', target: 'jq-extract-features' },

      // Parse → Extract Mapper (extract also needs parsed_collection for drawing metadata)
      { id: 'edge-parse-to-extract', source: 'jq-parse-collection', target: 'jq-extract-features' },

      // Extract Mapper → Aggregate (collects all iteration results)
      {
        id: 'edge-extract-to-aggregate',
        source: 'jq-extract-features',
        target: 'jq-aggregate-styles',
      },

      // Aggregate → Taxonomy Prompt
      {
        id: 'edge-aggregate-to-taxonomy-prompt',
        source: 'jq-aggregate-styles',
        target: 'template-taxonomy-prompt',
      },

      // Taxonomy Prompt → Generate Taxonomy
      {
        id: 'edge-taxonomy-prompt-to-model',
        source: 'template-taxonomy-prompt',
        target: 'model-generate-taxonomy',
      },

      // Generate Taxonomy → Structure Results
      {
        id: 'edge-taxonomy-to-structure',
        source: 'model-generate-taxonomy',
        target: 'jq-structure-results',
      },

      // Also need aggregated data for structure
      {
        id: 'edge-aggregate-to-structure',
        source: 'jq-aggregate-styles',
        target: 'jq-structure-results',
      },

      // Structure → Variety Check
      { id: 'edge-structure-to-check', source: 'jq-structure-results', target: 'if-variety-check' },

      // Variety Check → Rich Report (true branch)
      {
        id: 'edge-check-to-rich',
        source: 'if-variety-check',
        target: 'template-rich-report',
        sourceHandle: 'true_output',
      },

      // Variety Check → Limited Report (false branch)
      {
        id: 'edge-check-to-limited',
        source: 'if-variety-check',
        target: 'template-limited-report',
        sourceHandle: 'false_output',
      },

      // Both reports → Final Analysis
      {
        id: 'edge-rich-to-final',
        source: 'template-rich-report',
        target: 'model-comparative-analysis',
      },
      {
        id: 'edge-limited-to-final',
        source: 'template-limited-report',
        target: 'model-comparative-analysis',
      },

      // Final Analysis → Output
      {
        id: 'edge-final-to-output',
        source: 'model-comparative-analysis',
        target: 'output-style-guide',
      },
    ],
    metadata: {
      name: 'Architecture Drawing Styles Discovery',
      description:
        'Complex flow with data mapper iteration: Analyzes conceptual architecture drawings to discover and categorize visual styles, generating a comprehensive style taxonomy',
      created: new Date().toISOString(),
      tags: ['data-mapper', 'ai-analysis', 'architecture', 'visual-analysis', 'taxonomy'],
    },
  };
}

/**
 * Agent with Gmail Tool Flow
 *
 * A simple flow demonstrating an Agent node with the Gmail tool.
 * The agent can search and read emails to answer user questions.
 *
 * Flow structure:
 *   Input (user question) → Agent (with Gmail tool) → Template (format response)
 *
 * NOTE: Requires a Gmail OAuth2 credential to be set up before running.
 * The credential should use the google_gmail OAuth2 provider.
 */
function buildAgentGmailFlow(aiCredentialId: string): FlowlibDefinition {
  return {
    nodes: [
      // Input: The user's question about their emails
      {
        id: 'input-question',
        type: 'trigger.manual',
        label: 'User Question',
        referenceId: 'user_question',
        params: {
          variableName: 'question',
          defaultValue: 'What are my most recent unread emails about?',
        },
        position: { x: 100, y: 200 },
      },

      // Agent: AI agent with Gmail tool enabled
      // NOTE: The Gmail tool requires a Gmail OAuth2 credential to be configured
      // in the tool's params when adding it via the UI
      {
        id: 'agent-email-assistant',
        type: 'core.agent',
        label: 'Email Assistant Agent',
        referenceId: 'email_agent',
        params: {
          credentialId: aiCredentialId,
          model: 'claude-sonnet-4-20250514',
          taskPrompt: `You are an email assistant. The user has asked: "{{ user_question }}"

Please help the user by:
1. First, search their Gmail inbox for relevant emails using the gmail_list_emails tool
2. Analyze the email subjects and snippets to understand the content
3. Provide a helpful summary answering the user's question

If the user is asking about unread emails, use the query "is:unread".
If they're asking about emails from a specific sender, use "from:sender@example.com".
If they're asking about a specific topic, use that topic as the search query.

After retrieving the emails, summarize what you found in a clear, helpful manner.`,
          systemPrompt:
            "You are a helpful email assistant. You have access to the user's Gmail and can search and read their emails to help answer their questions. Always be concise but thorough in your responses.",
          // Note: addedTools should be configured via the UI with the Gmail tool
          // which requires a Gmail OAuth2 credential (google_gmail provider)
          addedTools: [],
          maxIterations: 5,
          stopCondition: 'explicit_stop' as const,
          temperature: 0.7,
          enableParallelTools: true,
        },
        position: { x: 400, y: 200 },
      },

      // Template: Format the agent's response
      {
        id: 'template-response',
        type: 'core.template_string',
        label: 'Format Response',
        referenceId: 'formatted_response',
        params: {
          template: `## Email Summary

{{ email_agent.finalResponse }}

---
*Powered by AI Email Assistant*`,
        },
        position: { x: 700, y: 200 },
      },
    ],
    edges: [
      { id: 'edge-input-to-agent', source: 'input-question', target: 'agent-email-assistant' },
      {
        id: 'edge-agent-to-template',
        source: 'agent-email-assistant',
        target: 'template-response',
      },
    ],
    metadata: {
      name: 'Agent Gmail Assistant',
      description:
        'AI Agent that uses the Gmail tool to search and summarize emails. Requires Gmail OAuth2 credential to be configured on the Gmail tool.',
      created: new Date().toISOString(),
      tags: ['agent', 'gmail', 'oauth2', 'email', 'ai-assistant'],
    },
  };
}

/**
 * Triggered Linear Agent Flow
 *
 * A flow with two entry points (manual trigger + cron), an AI agent that interacts
 * with Linear, a Gmail notification, and a final output summary.
 *
 * Flow structure:
 *
 *   [Manual: Linear]    [Cron: every 2 min]
 *         ↓                     ↓
 *         └──────→ JQ ←────────┘
 *                  ↓
 *            Agent (Linear)
 *                  ↓
 *            Gmail: Send Email
 *                  ↓
 *              Output
 */
function buildTriggeredLinearAgentFlow(aiCredentialId: string): FlowlibDefinition {
  return {
    nodes: [
      // ── Trigger 1: Manual trigger (simulates Linear event) ────────
      {
        id: 'trigger-linear-manual',
        type: 'trigger.manual',
        label: 'Linear Event (Manual)',
        referenceId: 'linear_event',
        params: {
          defaultInputs: {
            source: 'manual',
            issue_id: 'ISSUE-123',
            issue_title: 'Sample Linear issue for testing',
          },
        },
        position: { x: 100, y: 100 },
      },

      // ── Trigger 2: Cron every 2 minutes ───────────────────────────
      {
        id: 'trigger-cron-2min',
        type: 'trigger.cron',
        label: 'Every 2 Minutes',
        referenceId: 'cron_trigger',
        params: {
          expression: '*/2 * * * *',
          timezone: 'UTC',
          staticInputs: {
            source: 'cron',
            note: 'Scheduled check-in — no webhook payload available.',
          },
        },
        position: { x: 100, y: 350 },
      },

      // ── JQ: Normalise trigger data ────────────────────────────────
      // Both triggers converge here.  When the webhook fires we pull
      // the Linear issue title + id.  When the cron fires we produce a
      // fallback payload so the downstream agent always gets the same shape.
      {
        id: 'jq-normalise',
        type: 'core.jq',
        label: 'Normalise Trigger Data',
        referenceId: 'trigger_data',
        params: {
          query: `
{
  source: (.linear_event.source // "cron"),
  issue_id: (.linear_event.issue_id // "no-issue"),
  issue_title: (.linear_event.issue_title // "Scheduled check-in"),
  triggered_at: (now | todate)
}`.trim(),
        },
        position: { x: 400, y: 225 },
      },

      // ── Agent: Linear assistant ───────────────────────────────────
      {
        id: 'agent-linear',
        type: 'core.agent',
        label: 'Linear Assistant Agent',
        referenceId: 'linear_agent',
        params: {
          credentialId: aiCredentialId,
          model: 'claude-sonnet-4-20250514',
          taskPrompt: `You are a helpful Linear project assistant.

Trigger information:
- Source: {{ trigger_data.source }}
- Issue ID: {{ trigger_data.issue_id }}
- Issue Title: {{ trigger_data.issue_title }}
- Triggered at: {{ trigger_data.triggered_at }}

Your task:
1. If the source is "webhook" (a new issue was just created):
   - Use the linear_list_issues tool to fetch the 3 most recent issues so you have context.
   - Then use linear_create_issue to add a follow-up issue titled
     "Review: {{ trigger_data.issue_title }}" with a body summarising
     why this review is useful.
2. If the source is "cron" (scheduled check-in):
   - Use linear_list_issues to fetch the 5 most recent open issues.
   - Summarise their status in a short paragraph.

After performing the actions, write a final summary of what you did.`,
          systemPrompt:
            'You are an automation assistant integrated with Linear.  Be concise and professional.  Always finish with a clear summary.',
          addedTools: [],
          maxIterations: 8,
          stopCondition: 'explicit_stop' as const,
          temperature: 0.4,
          enableParallelTools: true,
        },
        position: { x: 700, y: 225 },
      },

      // ── Gmail: Send notification ──────────────────────────────────
      {
        id: 'gmail-notify',
        type: 'gmail.send_message',
        label: 'Send Email Notification',
        referenceId: 'email_notification',
        params: {
          credentialId: '', // Must be set via UI with a Gmail OAuth2 credential
          to: 'user@example.com',
          subject: 'Flowlib — Linear Agent Report ({{ trigger_data.source }})',
          body: `Hi Rohan,

The Linear Assistant Agent just ran (trigger source: {{ trigger_data.source }}).

Here is the agent's report:

{{ linear_agent.finalResponse }}

---
Issue context:
- Issue ID: {{ trigger_data.issue_id }}
- Issue Title: {{ trigger_data.issue_title }}
- Triggered at: {{ trigger_data.triggered_at }}

— Flowlib Automation`,
          isHtml: false,
        },
        position: { x: 1000, y: 225 },
      },

      // ── Output ────────────────────────────────────────────────────
      {
        id: 'output-summary',
        type: 'core.output',
        label: 'Flow Output',
        referenceId: 'flow_output',
        params: {
          outputValue: `{
  "trigger": "{{ trigger_data.source }}",
  "issue": "{{ trigger_data.issue_title }}",
  "agentSummary": "{{ linear_agent.finalResponse }}",
  "emailSent": true
}`,
          outputName: 'summary',
        },
        position: { x: 1300, y: 225 },
      },
    ],
    edges: [
      // Both triggers feed into the JQ normaliser
      { id: 'edge-manual-to-jq', source: 'trigger-linear-manual', target: 'jq-normalise' },
      { id: 'edge-cron-to-jq', source: 'trigger-cron-2min', target: 'jq-normalise' },
      // Linear chain: JQ → Agent → Gmail → Output
      { id: 'edge-jq-to-agent', source: 'jq-normalise', target: 'agent-linear' },
      { id: 'edge-agent-to-gmail', source: 'agent-linear', target: 'gmail-notify' },
      { id: 'edge-gmail-to-output', source: 'gmail-notify', target: 'output-summary' },
    ],
    metadata: {
      name: 'Triggered Linear Agent',
      description:
        'Uses a manual trigger and a 2-minute cron schedule.  An AI agent performs Linear actions, sends an email report via Gmail, and writes a summary to the flow output.',
      created: new Date().toISOString(),
      tags: ['triggers', 'cron', 'linear', 'agent', 'gmail', 'automation'],
    },
  };
}

async function runAllSeeds() {
  console.log(`📂 Database: ${sqlitePath}\n`);

  // Initialize Flowlib
  const flowlib = new Flowlib({
    encryptionKey: process.env.FLOWLIB_ENCRYPTION_KEY || 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    database: {
      type: 'sqlite',
      connectionString: `file:${sqlitePath}`,
    },
    logging: { level: 'warn' },
  });

  try {
    console.log('⚙️  Initializing Flowlib...');
    await flowlib.initialize();
    console.log('✅ Flowlib initialized\n');

    const seededFlows: string[] = [];
    const seededCredentials: string[] = [];

    const recreateFlow = async (name: string, flowlibDefinition: FlowlibDefinition) => {
      const { data: existingFlows } = await flowlib.listFlows();
      const matchingFlows = existingFlows.filter((flow) => flow.name === name);

      for (const flow of matchingFlows) {
        await flowlib.deleteFlow(flow.id);
      }

      const createdFlow = await flowlib.createFlow({ name, isActive: false });
      await flowlib.createFlowVersion(createdFlow.id, { flowlibDefinition });
      seededFlows.push(`  ✓ ${createdFlow.name} (${createdFlow.id})`);
      return createdFlow;
    };

    // ============ SEED FLOWS ============

    // Seed 1: Complex Branching Flow (Adult)
    console.log('🌱 Seeding: User Age Check Flow (Adult)...');
    await recreateFlow('User Age Check (Adult)', buildComplexBranchingFlow(true));

    // Seed 2: Complex Branching Flow (Minor)
    console.log('🌱 Seeding: User Age Check Flow (Minor)...');
    await recreateFlow('User Age Check (Minor)', buildComplexBranchingFlow(false));

    // Seed 3: Simple Template Flow
    console.log('🌱 Seeding: Simple Template Flow...');
    await recreateFlow('Simple Template Flow', buildSimpleTemplateFlow());

    // Seed 4: JQ Transform Flow
    console.log('🌱 Seeding: JQ Data Transform Flow...');
    await recreateFlow('JQ Data Transform', buildJqTransformFlow());

    // Seed 5: Comprehensive Order Processing Flow
    console.log('🌱 Seeding: E-Commerce Order Processing Flow...');
    const orderFlowDef = buildComprehensiveOrderFlow();
    // Update AI model nodes with credential ID if available
    if (anthropicCredentialId) {
      const aiNode = orderFlowDef.nodes.find((n) => n.id === 'model-vip-ai');
      if (aiNode && aiNode.params) {
        (aiNode.params as Record<string, unknown>).credentialId = anthropicCredentialId;
      }
    }
    await recreateFlow('E-Commerce Order Processing', orderFlowDef);

    // Seed 6: AI Chat Flow
    console.log('🌱 Seeding: AI Chat Flow...');
    const aiFlowDef = buildAiChatFlow();
    // Update AI model node with credential ID if available
    if (anthropicCredentialId) {
      const aiNode = aiFlowDef.nodes.find((n) => n.id === 'model-response');
      if (aiNode && aiNode.params) {
        (aiNode.params as Record<string, unknown>).credentialId = anthropicCredentialId;
      }
    }
    await recreateFlow('AI Chat Flow', aiFlowDef);

    // Seed 7: Comprehensive Multi-Stage Flow (Premium User)
    if (anthropicCredentialId) {
      console.log('🌱 Seeding: Comprehensive Multi-Stage Flow (Premium)...');
      await recreateFlow(
        'Comprehensive Flow (Premium User)',
        buildComprehensiveMultiStageFlow(anthropicCredentialId, true),
      );

      // Seed 8: Comprehensive Multi-Stage Flow (Basic User)
      console.log('🌱 Seeding: Comprehensive Multi-Stage Flow (Basic)...');
      await recreateFlow(
        'Comprehensive Flow (Basic User)',
        buildComprehensiveMultiStageFlow(anthropicCredentialId, false),
      );

      // Seed 9: Architecture Drawing Styles Flow (with Data Mapper)
      console.log('🌱 Seeding: Architecture Drawing Styles Discovery Flow (with data mapper)...');
      await recreateFlow(
        'Architecture Drawing Styles Discovery',
        buildArchitectureStylesFlow(anthropicCredentialId),
      );

      // Seed 10: Agent Gmail Assistant Flow
      console.log('🌱 Seeding: Agent Gmail Assistant Flow...');
      await recreateFlow('Agent Gmail Assistant', buildAgentGmailFlow(anthropicCredentialId));

      // Seed 11: Triggered Linear Agent Flow (manual + cron + agent + gmail + output)
      console.log('🌱 Seeding: Triggered Linear Agent Flow...');
      await recreateFlow(
        'Triggered Linear Agent',
        buildTriggeredLinearAgentFlow(anthropicCredentialId),
      );
    } else {
      console.log('⚠️  Skipping Comprehensive Flows - no AI credential available');
    }

    // Seed 12: Rich non-AI branching flow for UI/testing
    console.log('🌱 Seeding: Operations Escalation Matrix Flow...');
    await recreateFlow('Operations Escalation Matrix', buildOperationsEscalationFlow());

    // ============ SUMMARY ============
    console.log('\n🎉 All seeds completed successfully!');

    if (seededCredentials.length > 0) {
      console.log('\nSeeded credentials:');
      seededCredentials.forEach((c) => console.log(c));
    }

    console.log('\nSeeded flows:');
    seededFlows.forEach((f) => console.log(f));

    // Cleanup
    await flowlib.shutdown();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Seed process failed:', error);
    await flowlib.shutdown();
    process.exit(1);
  }
}

runAllSeeds();
