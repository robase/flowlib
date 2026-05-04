export const CREDENTIAL_TYPES = ['http-api', 'database', 'llm'] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const CREDENTIAL_AUTH_TYPES = [
  'apiKey',
  'bearer',
  'basic',
  'oauth2',
  'custom',
  'awsSigV4',
  'jwt',
  'connectionString',
] as const;

export type CredentialAuthType = (typeof CREDENTIAL_AUTH_TYPES)[number];

export interface CredentialConfig {
  apiKey?: string;
  location?: 'header' | 'query';
  paramName?: string;
  token?: string;
  username?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  clientId?: string;
  clientSecret?: string;
  oauth2Provider?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  headers?: Record<string, string>;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  service?: string;
  algorithm?: string;
  secret?: string;
  connectionString?: string;
  expiresAt?: string;
  apiUrl?: string;
  baseUrl?: string;
  endpoint?: string;
  [key: string]: unknown;
}
