import './global.api-auto-imports.js'

export * from './global.api-auto-imports.js'

export * from './errors.js'
export * from './functions/graphql.js'
export * from './functions/useRequireAuth.js'
export * from './makeMergedSchema.js'
export * from './createGraphQLServer.js'

// These types are also exported from `@cedarjs/graphql-server/types`
export type {
  Resolver,
  Services,
  ResolverArgs,
  SdlGlobImports,
  ServicesGlobImports,
  MakeServicesInterface,
  MakeServices,
  GraphQLTypeWithFields,
  UseCedarDirectiveReturn,
  useRedwoodDirectiveReturn,
  DirectivePluginOptions,
  CedarTrustedDocumentOptions,
  RedwoodTrustedDocumentOptions,
  GetCurrentUser,
  GenerateGraphiQLHeader,
  Context,
  ContextFunction,
  ArmorConfig,
  CedarGraphQLContext,
  RedwoodGraphQLContext,
  CedarOpenTelemetryConfig,
  RedwoodOpenTelemetryConfig,
  CedarScalarConfig,
  RedwoodScalarConfig,
  RealtimeTypeMap,
  MinimalRealtimeOptions,
  RealtimeOptions,
  GraphQLYogaOptions,
  GraphQLHandlerOptions,
  GraphiQLOptions,
} from './types.js'

export {
  createValidatorDirective,
  createTransformerDirective,
  getDirectiveName,
  makeDirectivesForPlugin,
} from './directives/makeDirectives.js'

export {
  hasDirective,
  DirectiveType,
  useCedarDirective,
  useRedwoodDirective,
} from './plugins/useRedwoodDirective.js'

export type {
  DirectiveParams,
  CedarDirective,
  RedwoodDirective,
  ValidatorDirective,
  ValidatorDirectiveFunc,
  TransformerDirective,
  TransformerDirectiveFunc,
  ValidateArgs,
  TransformArgs,
} from './plugins/useRedwoodDirective.js'

export * as rootSchema from './rootSchema.js'

// Note: We re-export here for convenience and backwards compatibility
export { context, setContext } from '@cedarjs/context'
