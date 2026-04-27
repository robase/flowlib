import { describe, it, expect } from 'vitest';
import { emitSdkSource } from '@flowlib/sdk';
import {
  substituteCredentialEnvs,
  defaultDeriveEnvName,
} from '../src/backend/credential-env-substitution';

describe('defaultDeriveEnvName', () => {
  it('strips cred_ prefix and trailing digits, appends _CREDENTIAL', () => {
    expect(defaultDeriveEnvName('cred_openai_abc')).toBe('OPENAI_ABC_CREDENTIAL');
    expect(defaultDeriveEnvName('cred_openai_abc_7')).toBe('OPENAI_ABC_CREDENTIAL');
    expect(defaultDeriveEnvName('cred-anthropic')).toBe('ANTHROPIC_CREDENTIAL');
  });

  it('handles ids without the cred_ prefix', () => {
    expect(defaultDeriveEnvName('openai-prod-1')).toBe('OPENAI_PROD_CREDENTIAL');
  });

  it('returns a sensible fallback for empty / weird ids', () => {
    expect(defaultDeriveEnvName('')).toBe('CREDENTIAL');
    expect(defaultDeriveEnvName('cred_')).toBe('CREDENTIAL');
    expect(defaultDeriveEnvName('_123')).toBe('CREDENTIAL');
  });

  it('normalises weird characters to underscores', () => {
    expect(defaultDeriveEnvName('cred.openai.abc')).toBe('OPENAI_ABC_CREDENTIAL');
    expect(defaultDeriveEnvName('my$weird!id')).toBe('MY_WEIRD_ID_CREDENTIAL');
  });
});

describe('substituteCredentialEnvs', () => {
  describe('human-readable section rewrites', () => {
    it('rewrites raw credentialId literals', () => {
      const source = `
export const myFlow = defineFlow({
  nodes: [
    model("ai", { credentialId: "cred_openai_abc", model: "gpt-4o", prompt: "hi" }),
  ],
  edges: [],
});
`;
      const result = substituteCredentialEnvs(source);
      expect(result).toContain(`credentialId: "{{env.OPENAI_ABC_CREDENTIAL}}"`);
      expect(result).not.toContain(`"cred_openai_abc"`);
    });

    it('handles single-quoted strings too', () => {
      const source = `credentialId: 'cred_slack_prod'`;
      const result = substituteCredentialEnvs(source);
      expect(result).toBe(`credentialId: '{{env.SLACK_PROD_CREDENTIAL}}'`);
    });

    it('leaves already-substituted env references untouched', () => {
      const source = `credentialId: "{{env.OPENAI_CREDENTIAL}}"`;
      expect(substituteCredentialEnvs(source)).toBe(source);
    });

    it('rewrites every occurrence across multiple nodes', () => {
      const source = `
model("m1", { credentialId: "cred_a", model: "x", prompt: "y" }),
agent("a1", { credentialId: "cred_b", model: "x", taskPrompt: "y" }),
`;
      const result = substituteCredentialEnvs(source);
      expect(result).toContain(`credentialId: "{{env.A_CREDENTIAL}}"`);
      expect(result).toContain(`credentialId: "{{env.B_CREDENTIAL}}"`);
    });

    it('rewrites credentialIds nested inside agent addedTools', () => {
      const source = `
agent("a1", {
  credentialId: "cred_openai",
  model: "gpt-4o",
  taskPrompt: "x",
  addedTools: [
    tool("gmail.send_message", {
      params: { credentialId: "cred_gmail_user" },
    }),
  ],
}),
`;
      const result = substituteCredentialEnvs(source);
      expect(result).toContain(`credentialId: "{{env.OPENAI_CREDENTIAL}}"`);
      expect(result).toContain(`credentialId: "{{env.GMAIL_USER_CREDENTIAL}}"`);
    });
  });

  describe('JSON footer preservation', () => {
    it('leaves the footer verbatim — raw ids stay for authoritative pull', () => {
      const human = `model("m", { credentialId: "cred_openai_abc", model: "x", prompt: "y" });\n\n`;
      const footer = `/* @flowlib-definition\n{"nodes":[{"params":{"credentialId":"cred_openai_abc"}}]}\n*/\n`;
      const source = human + footer;

      const result = substituteCredentialEnvs(source);

      // Human section rewritten.
      expect(result).toContain(`credentialId: "{{env.OPENAI_ABC_CREDENTIAL}}"`);
      // Footer untouched.
      expect(result).toContain(footer);
      // Footer's `credentialId":"cred_openai_abc` survives verbatim.
      expect(result).toContain('"credentialId":"cred_openai_abc"');
    });

    it('handles source without a footer — whole thing is human-readable', () => {
      const source = `credentialId: "cred_plain"`;
      expect(substituteCredentialEnvs(source)).toBe(`credentialId: "{{env.PLAIN_CREDENTIAL}}"`);
    });
  });

  describe('custom deriveEnvName', () => {
    it('uses the callers name-mapping function', () => {
      const source = `credentialId: "cred_xyz"`;
      const result = substituteCredentialEnvs(source, {
        deriveEnvName: (id) => `CUSTOM_${id.toUpperCase()}`,
      });
      expect(result).toBe(`credentialId: "{{env.CUSTOM_CRED_XYZ}}"`);
    });
  });
});

describe('integration: emit + substitute (the sync plugin path)', () => {
  it('produces a flow file where humans see env refs and the footer has raw ids', () => {
    const definition = {
      nodes: [
        {
          id: 'n1',
          type: 'core.model',
          referenceId: 'ai',
          params: {
            credentialId: 'cred_openai_abc',
            model: 'gpt-4o',
            prompt: 'Say hi',
          },
        },
      ],
      edges: [],
      metadata: { name: 'Portable flow' },
    };

    const { code } = emitSdkSource(definition, {
      flowName: 'portableFlow',
      includeJsonFooter: true,
    });
    const final = substituteCredentialEnvs(code);

    // Split on the footer marker so we can assert on each side independently.
    const [human, footer] = final.split('/* @flowlib-definition');
    expect(human).toContain(`credentialId: "{{env.OPENAI_ABC_CREDENTIAL}}"`);
    expect(human).not.toContain(`"cred_openai_abc"`);
    // Footer keeps the raw id.
    expect(footer).toContain('"credentialId":"cred_openai_abc"');
  });

  it('portability: two different instances can use the same committed file', () => {
    const definition = {
      nodes: [
        {
          id: 'n1',
          type: 'core.model',
          referenceId: 'ai',
          params: { credentialId: 'cred_dev_openai_123', model: 'x', prompt: 'y' },
        },
      ],
      edges: [],
    };

    const { code } = emitSdkSource(definition, {
      flowName: 'f',
      includeJsonFooter: true,
    });
    const committed = substituteCredentialEnvs(code);

    // The human-readable section uses an env ref. A dev instance and a
    // prod instance can map `DEV_OPENAI_CREDENTIAL` to different real
    // credential ids in their runtime env; the committed file is the same.
    expect(committed).toContain(`{{env.DEV_OPENAI_CREDENTIAL}}`);
  });
});
