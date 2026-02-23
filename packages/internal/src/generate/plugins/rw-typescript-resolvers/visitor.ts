import type { FederationMeta } from '@graphql-codegen/plugin-helpers'
import type { TypeScriptResolversPluginConfig } from '@graphql-codegen/typescript-resolvers'
import { TypeScriptResolversVisitor } from '@graphql-codegen/typescript-resolvers'
import { DeclarationBlock } from '@graphql-codegen/visitor-plugin-common'
import type { FieldDefinitionResult } from '@graphql-codegen/visitor-plugin-common'
import type {
  FieldDefinitionNode,
  GraphQLSchema,
  ObjectTypeDefinitionNode,
} from 'graphql'

export class RwTypeScriptResolversVisitor extends TypeScriptResolversVisitor {
  constructor(
    pluginConfig: TypeScriptResolversPluginConfig,
    schema: GraphQLSchema,
  ) {
    // Pass an empty FederationMeta object since we don't use Apollo Federation.
    super(pluginConfig, schema, {} as FederationMeta)
  }

  FieldDefinition(
    node: FieldDefinitionNode,
    key: string | number,
    parent: any,
  ): FieldDefinitionResult {
    const hasArguments = node.arguments && node.arguments.length > 0

    const superFieldDefinition = super.FieldDefinition(node, key, parent)

    return {
      node: superFieldDefinition.node,
      printContent: (parentNode, avoidResolverOptionals) => {
        // We're reusing pretty much all of the logic in the original plugin
        // Visitor implementation by calling the `super` method here
        const result = superFieldDefinition.printContent(
          parentNode,
          avoidResolverOptionals,
        )

        // If this field doesn't take any arguments, and it is a resolver, then
        // we switch to using the OptArgsResolver type instead, so that the user
        // isn't forced to pass in arguments that aren't going to be used anyway
        if (!hasArguments && result.value?.includes(': Resolver<')) {
          return {
            ...result,
            value: result.value.replace(': Resolver<', ': OptArgsResolverFn<'),
          }
        }

        return result
      },
    }
  }

  // Original implementation is here:
  // https://github.com/dotansimha/graphql-code-generator/blob/c6c60a3078f3797af435c3852220d8898964031d/packages/plugins/other/visitor-plugin-common/src/base-resolvers-visitor.ts#L1091
  ObjectTypeDefinition(node: ObjectTypeDefinitionNode): string | null {
    // Call the original implementation to get a block of resolvers
    const originalBlock = super.ObjectTypeDefinition(node)

    // The rest of this function is pretty much a copy/paste of the original
    // function. We're duplicating every block to get RequiredResolver types
    // for use with what we call "relation resolvers" (The stuff at the bottom
    // of service files for models that have relations)
    const name = this.convertName(node, {
      suffix: this.config.resolverTypeSuffix,
    })
    const typeName = node.name.value
    const parentType = this.getParentTypeToUse(typeName)
    const fieldsContent = (node.fields || []).map((f) => {
      if ('printContent' in f && typeof f.printContent === 'function') {
        return f.printContent(node, false).value
      } else {
        throw new Error('Unexpected field type')
      }
    })

    // This is what's different compared to the implementation I copy/pasted
    // We create a new block with a different type called
    // "ModelRelationResolver" where "Model" is the name of a prisma model.
    // We also replace all Resolver types with RequiredResolverFn types where
    // all arguments are required
    //
    // 1. We start by creating a DeclarationBlock. So something on the form
    //    X = {}
    // 2. Begin by defining X. It should be an exported type.
    // 3. `name` is our resolvers, so like 'PostResolvers', 'RedwoodResolvers',
    //    'QueryResolvers' etc.
    //    Replace 'Resolvers' with 'RelationResolvers' to construct our type name.
    //    Also set the generics for the type
    // 4. Time to generate our Block, i.e. what goes inside {} in the X = {} that
    //    we started with.
    // 5. `fieldsContent` is something like
    //    [
    //      "  contact: Resolver<Maybe<ResolversTypes['Contact']>, ParentType, ContextType, RequireFields<QuerycontactArgs, 'id'>>;",
    //      "  contacts: OptArgsResolverFn<Array<ResolversTypes['Contact']>, ParentType, ContextType>;",
    //      "  post: Resolver<Maybe<ResolversTypes['Post']>, ParentType, ContextType, RequireFields<QuerypostArgs, 'id'>>;",
    //      "  posts: OptArgsResolverFn<Array<ResolversTypes['Post']>, ParentType, ContextType>;",
    //      "  redwood: OptArgsResolverFn<Maybe<ResolversTypes['Redwood']>, ParentType, ContextType>;",
    //      "  user: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType, RequireFields<QueryuserArgs, 'id'>>;"
    //    ]
    //    Here the type name needs to be replaced by 'RequiredResolverFn'. We
    //    do that by running a regex `replace()` on the string
    // 6. Finally we join the array with '\n' and we'll have something that
    //    looks like the type below that we can return together whatever the
    //    original implementation of this function returned (this is a
    //    different example than the one above)
    //    export type PostRelationResolvers<ContextType = RedwoodGraphQLContext, ParentType extends ResolversParentTypes['Post'] = ResolversParentTypes['Post']> = {
    //      author?: RequiredResolverFn<ResolversTypes['User'], ParentType, ContextType>;
    //      authorId?: RequiredResolverFn<ResolversTypes['Int'], ParentType, ContextType>;
    //      body?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
    //      createdAt?: RequiredResolverFn<ResolversTypes['DateTime'], ParentType, ContextType>;
    //      id?: RequiredResolverFn<ResolversTypes['Int'], ParentType, ContextType>;
    //      title?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
    //    };
    const blockRelationsResolver = new DeclarationBlock(
      this._declarationBlockConfig,
    )
      .export()
      .asKind('type')
      .withName(
        name.replace('Resolvers', 'RelationResolvers'),
        `<ContextType = ${
          this.config.contextType.type
        }, ${this.transformParentGenericType(parentType)}>`,
      )
      .withBlock(
        fieldsContent
          // printContent can return null for fields that should be skipped
          // (e.g., federation-only fields), so we filter those out
          .filter((content): content is string => content !== null)
          .map((content) =>
            // In v5, fields may already carry an optional marker `?:`. The
            // regex consumes the optional `?` so we don't emit a double `??`.
            content.replace(
              /\??: (?:OptArgs)?Resolver(?:Fn)?/,
              '?: RequiredResolverFn',
            ),
          )
          .join('\n'),
      )

    // originalBlock can be null if the type has no fields to generate
    if (originalBlock === null) {
      return null
    }

    return originalBlock + '\n' + blockRelationsResolver.string
  }
}
