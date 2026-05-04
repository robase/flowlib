/**
 * OAuth2 endpoint slice.
 *
 *   GET  /credentials/oauth2/providers
 *   GET  /credentials/oauth2/providers/:providerId
 *   POST /credentials/oauth2/start
 *   POST /credentials/oauth2/callback
 *   GET  /credentials/oauth2/callback   — public, redirects on error
 *
 * The GET callback is the only `public` endpoint here — OAuth providers
 * redirect the user-agent to it before any session exists. It returns a
 * `Response` with a 302 when an error param is present (redirects back to
 * the original returnUrl with `?oauth_error=…` appended).
 */

import { defineEndpoint, type FlowlibHttpEndpoint } from './types';

const listProviders = defineEndpoint({
  id: 'oauth2.listProviders',
  method: 'GET',
  path: '/credentials/oauth2/providers',
  auth: { kind: 'protected', permission: 'credential:read' },
  async handle({ flowlib }) {
    return { kind: 'json', status: 200, body: flowlib.credentials.getOAuth2Providers() };
  },
});

const getProvider = defineEndpoint({
  id: 'oauth2.getProvider',
  method: 'GET',
  path: '/credentials/oauth2/providers/:providerId',
  auth: { kind: 'protected', permission: 'credential:read' },
  async handle({ flowlib, request }) {
    const provider = flowlib.credentials.getOAuth2Provider(request.params.providerId);
    if (!provider) {
      return {
        kind: 'json',
        status: 404,
        body: { error: 'OAuth2 provider not found' },
      };
    }
    return { kind: 'json', status: 200, body: provider };
  },
});

const startFlow = defineEndpoint({
  id: 'oauth2.start',
  method: 'POST',
  path: '/credentials/oauth2/start',
  auth: { kind: 'protected', permission: 'credential:create' },
  async handle({ flowlib, request }) {
    const {
      providerId,
      clientId,
      clientSecret,
      redirectUri,
      scopes,
      returnUrl,
      credentialName,
      existingCredentialId,
    } = (request.body ?? {}) as Record<string, unknown>;

    if (existingCredentialId && redirectUri) {
      return {
        kind: 'json',
        status: 200,
        body: await flowlib.credentials.startOAuth2FlowForCredential(
          existingCredentialId as string,
          redirectUri as string,
          { scopes: scopes as string[] | undefined, returnUrl: returnUrl as string | undefined },
        ),
      };
    }

    if (!providerId || !clientId || !clientSecret || !redirectUri) {
      return {
        kind: 'json',
        status: 400,
        body: {
          error: 'Missing required fields: providerId, clientId, clientSecret, redirectUri',
        },
      };
    }

    return {
      kind: 'json',
      status: 200,
      body: flowlib.credentials.startOAuth2Flow(
        providerId as string,
        {
          clientId: clientId as string,
          clientSecret: clientSecret as string,
          redirectUri: redirectUri as string,
        },
        {
          scopes: scopes as string[] | undefined,
          returnUrl: returnUrl as string | undefined,
          credentialName: credentialName as string | undefined,
          existingCredentialId: existingCredentialId as string | undefined,
        },
      ),
    };
  },
});

const callbackPost = defineEndpoint({
  id: 'oauth2.callbackPost',
  method: 'POST',
  path: '/credentials/oauth2/callback',
  auth: { kind: 'protected', permission: 'credential:create' },
  async handle({ flowlib, request }) {
    const { code, state, clientId, clientSecret, redirectUri } = (request.body ?? {}) as Record<
      string,
      string | undefined
    >;
    if (!code || !state) {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'Missing required fields: code, state' },
      };
    }
    const appConfig =
      clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : undefined;
    return {
      kind: 'json',
      status: 200,
      body: await flowlib.credentials.handleOAuth2Callback(code, state, appConfig),
    };
  },
});

const callbackGet = defineEndpoint({
  id: 'oauth2.callbackGet',
  method: 'GET',
  path: '/credentials/oauth2/callback',
  // Public: OAuth providers redirect the user-agent here before any session
  // is established. The handler still validates `state` so this isn't a
  // free-for-all entry point.
  auth: { kind: 'public' },
  async handle({ flowlib, request }) {
    const sp = request.searchParams;
    const code = sp.get('code');
    const state = sp.get('state');
    const error = sp.get('error');
    const errorDescription = sp.get('error_description');

    if (error) {
      const errorMsg = errorDescription || error;
      const pendingState = state ? flowlib.credentials.getOAuth2PendingState(state) : null;
      const returnUrl = pendingState?.returnUrl || '/';
      const separator = returnUrl.includes('?') ? '&' : '?';
      return {
        kind: 'response',
        response: new Response(null, {
          status: 302,
          headers: {
            Location: `${returnUrl}${separator}oauth_error=${encodeURIComponent(errorMsg)}`,
          },
        }),
      };
    }

    if (!code || !state) {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'Missing code or state parameter' },
      };
    }

    const pendingState = flowlib.credentials.getOAuth2PendingState(state);
    if (!pendingState) {
      return {
        kind: 'json',
        status: 400,
        body: { error: 'Invalid or expired OAuth state' },
      };
    }

    return {
      kind: 'json',
      status: 200,
      body: {
        message:
          'OAuth callback received. Use POST /credentials/oauth2/callback to exchange the code.',
        providerId: pendingState.providerId,
        returnUrl: pendingState.returnUrl,
      },
    };
  },
});

export const oauth2Endpoints: readonly FlowlibHttpEndpoint<unknown>[] = [
  listProviders,
  getProvider,
  startFlow,
  callbackPost,
  callbackGet,
] as readonly FlowlibHttpEndpoint<unknown>[];
