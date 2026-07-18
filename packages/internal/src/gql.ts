import { CodeFileLoader } from '@graphql-tools/code-file-loader'
import { loadSchema } from '@graphql-tools/load'
import type {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  OperationDefinitionNode,
  OperationTypeNode,
} from 'graphql'
import { Kind, parse, print, visit } from 'graphql'

import { rootSchema } from '@cedarjs/graphql-server'
import { getPaths } from '@cedarjs/project-config'

interface Operation {
  operation: OperationTypeNode
  name: string | undefined
  fields: (string | Field)[]
}

interface Field {
  string: (string | Field)[]
}

export const parseGqlQueryToAst = (gqlQuery: string) => {
  const ast = parse(gqlQuery)
  return parseDocumentAST(ast)
}

export const parseDocumentAST = (document: DocumentNode) => {
  const operations: Operation[] = []

  visit(document, {
    OperationDefinition(node: OperationDefinitionNode) {
      const fields: any[] = []

      node.selectionSet.selections.forEach((field) => {
        fields.push(getFields(field as FieldNode))
      })

      operations.push({
        operation: node.operation,
        name: node.name?.value,
        fields,
      })
    },
  })

  return operations
}

const getFields = (field: FieldNode): any => {
  // base
  if (!field.selectionSet) {
    return field.name.value
  } else {
    const obj: Record<string, FieldNode[]> = {
      [field.name.value]: [],
    }

    const lookAtFieldNode = (node: FieldNode | InlineFragmentNode): void => {
      node.selectionSet?.selections.forEach((subField) => {
        switch (subField.kind) {
          case Kind.FIELD:
            obj[field.name.value].push(getFields(subField))
            break
          case Kind.FRAGMENT_SPREAD:
            // TODO: Maybe this will also be needed, right now it's accounted for to not crash in the tests
            break
          case Kind.INLINE_FRAGMENT:
            lookAtFieldNode(subField)
        }
      })
    }

    lookAtFieldNode(field)

    return obj
  }
}

const parseGqlFragmentDefinition = (gqlFragment: string) => {
  const ast = parse(gqlFragment)

  return ast.definitions.find(
    (definition): definition is FragmentDefinitionNode =>
      definition.kind === Kind.FRAGMENT_DEFINITION,
  )
}

/**
 * Returns the name of the first fragment definition in the given GraphQL
 * source, e.g. `AuthorCell_author` for
 * `fragment AuthorCell_author on User { fullName }`
 */
export const parseGqlFragmentName = (gqlFragment: string) => {
  return parseGqlFragmentDefinition(gqlFragment)?.name.value
}

/**
 * Derives a fragment Cell's data prop name from its fragment: the prop the
 * parent Cell passes the fragment data in with, and the prop `Success`
 * receives the data as.
 *
 * For a fragment named with an underscore, like `AuthorCell_author`, the part
 * after the last underscore is used (`author`). Otherwise the type the
 * fragment is defined on is used, camelCased (`on User` -> `user`).
 *
 * Keep this in sync with getFragmentPropName in
 * packages/web/src/components/cell/createFragmentCell.tsx, which is what the
 * fragment Cell runtime uses.
 */
export const parseGqlFragmentPropName = (gqlFragment: string) => {
  const fragmentDefinition = parseGqlFragmentDefinition(gqlFragment)

  if (!fragmentDefinition) {
    return undefined
  }

  const fragmentName = fragmentDefinition.name.value
  const underscoreIndex = fragmentName.lastIndexOf('_')

  if (underscoreIndex > 0 && underscoreIndex < fragmentName.length - 1) {
    return fragmentName.slice(underscoreIndex + 1)
  }

  const typename = fragmentDefinition.typeCondition.name.value

  return typename.charAt(0).toLowerCase() + typename.slice(1)
}

export const listQueryTypeFieldsInProject = async () => {
  try {
    const schemaPointerMap = {
      [print(rootSchema.schema)]: {},
      'graphql/**/*.sdl.{js,ts}': {},
      'directives/**/*.{js,ts}': {},
      'subscriptions/**/*.{js,ts}': {},
    }

    const mergedSchema = await loadSchema(schemaPointerMap, {
      loaders: [
        new CodeFileLoader({
          noRequire: true,
          pluckConfig: {
            globalGqlIdentifierName: 'gql',
          },
        }),
      ],
      cwd: getPaths().api.src,
      assumeValidSDL: true,
    })

    const queryTypeFields = mergedSchema.getQueryType()?.getFields()

    // Return empty array if no schema found
    return Object.keys(queryTypeFields ?? {})
  } catch (e) {
    console.error(e)
    return []
  }
}
