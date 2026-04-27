/**
 * Action Types — re-exported from `@flowlib/action-kit`.
 *
 * This file exists so existing `src/actions/types` import paths inside
 * `@flowlib/core` keep resolving. All canonical definitions now live in the
 * standalone action-kit package so `@flowlib/actions` can consume them
 * without depending on `@flowlib/core`.
 */

export type {
  ActionDefinition,
  ActionExecutionContext,
  ActionResult,
  ActionCredential,
  ActionCategory,
  ProviderDef,
  ProviderCategory,
  CredentialRequirement,
  ParamField,
  ActionConfigUpdateContext,
  ActionConfigUpdateEvent,
  ActionConfigUpdateResponse,
  LoadOptionsContext,
  LoadOptionsConfig,
  LoadOptionsResult,
  ActionCredentialsService,
  ActionAIClient,
} from '@flowlib/action-kit';
