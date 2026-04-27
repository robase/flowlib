import { BatchProvider } from '@flowlib/action-kit';

interface ProviderMatchConfig {
  provider: BatchProvider;
  hosts: RegExp[];
  keywords?: string[];
}

const PROVIDER_PATTERNS: ProviderMatchConfig[] = [
  {
    provider: BatchProvider.OPENAI,
    hosts: [/\.openai\.com$/i, /openai\.azure\.com$/i],
    keywords: ['openai', 'gpt'],
  },
  {
    provider: BatchProvider.ANTHROPIC,
    hosts: [/\.anthropic\.com$/i],
    keywords: ['anthropic', 'claude'],
  },
  {
    provider: BatchProvider.OPENROUTER,
    hosts: [/\.openrouter\.ai$/i],
    keywords: ['openrouter'],
  },
];

function normalizeProviderString(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.trim().toUpperCase();
}

function detectProviderFromString(value?: string | null): BatchProvider | null {
  const normalized = normalizeProviderString(value);
  if (!normalized) {
    return null;
  }

  if (normalized.includes('OPENROUTER')) {
    return BatchProvider.OPENROUTER;
  }
  if (normalized.includes('OPENAI')) {
    return BatchProvider.OPENAI;
  }
  if (normalized.includes('ANTHROPIC') || normalized.includes('CLAUDE')) {
    return BatchProvider.ANTHROPIC;
  }

  return null;
}

function detectProviderFromUrl(url?: string | null): BatchProvider | null {
  if (!url) {
    return null;
  }

  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
  } catch {
    // URL constructor failed, attempt to treat the string as a bare hostname
    hostname =
      url
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        ?.toLowerCase() ?? '';
  }

  if (!hostname) {
    return null;
  }

  for (const entry of PROVIDER_PATTERNS) {
    if (entry.hosts.some((pattern) => pattern.test(hostname))) {
      return entry.provider;
    }

    if (entry.keywords?.some((keyword) => hostname.includes(keyword))) {
      return entry.provider;
    }
  }

  return null;
}

export function detectProviderFromCredential(
  credential?: {
    metadata?: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
  } | null,
): BatchProvider | null {
  if (!credential) {
    return null;
  }

  const metadataProvider = credential.metadata?.provider as string | undefined;
  const providerFromMetadata = detectProviderFromString(metadataProvider);
  if (providerFromMetadata) {
    return providerFromMetadata;
  }

  const configProvider = credential.config?.provider as string | undefined;
  const providerFromConfig = detectProviderFromString(configProvider);
  if (providerFromConfig) {
    return providerFromConfig;
  }

  const urlsToCheck: (string | undefined)[] = [
    credential.config?.apiUrl as string | undefined,
    credential.config?.baseUrl as string | undefined,
    credential.config?.endpoint as string | undefined,
  ];

  for (const candidate of urlsToCheck) {
    const provider = detectProviderFromUrl(candidate ?? null);
    if (provider) {
      return provider;
    }
  }

  const metadataUrl = credential.metadata?.apiUrl as string | undefined;
  if (metadataUrl) {
    return detectProviderFromUrl(metadataUrl);
  }

  return null;
}
