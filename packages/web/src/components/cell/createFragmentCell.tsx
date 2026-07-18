import React from 'react'

import type { DocumentNode, FragmentDefinitionNode } from 'graphql'
import { Kind } from 'graphql'

import { fragmentRegistry } from '../../apollo/fragmentRegistry.js'
import { useFragment } from '../GraphQLHooksProvider.js'

import type { CreateCellProps } from './cellTypes.js'
import { isDataEmpty } from './isCellEmpty.js'

function getFragmentDefinition(
  fragment: DocumentNode,
  displayName: string,
): FragmentDefinitionNode {
  const fragmentDefinition = fragment.definitions.find(
    (definition): definition is FragmentDefinitionNode =>
      definition.kind === Kind.FRAGMENT_DEFINITION,
  )

  if (!fragmentDefinition) {
    throw new Error(
      `The FRAGMENT export in ${displayName} must contain a GraphQL ` +
        'fragment definition, like ' +
        '`fragment AuthorCell_author on User { fullName }`',
    )
  }

  return fragmentDefinition
}

/**
 * Derives the Cell's data prop name: the prop the parent Cell passes the
 * fragment data in with, and the prop `Success` (and `Empty`) receive the
 * data as.
 *
 * For a fragment named with an underscore, like `AuthorCell_author`, the part
 * after the last underscore is used (`author`). Otherwise the type the
 * fragment is defined on is used, camelCased (`on User` -> `user`).
 *
 * Keep this in sync with parseGqlFragmentPropName in
 * packages/internal/src/gql.ts, which is used when generating the mirror
 * types for fragment Cells.
 */
function getFragmentPropName(fragmentDefinition: FragmentDefinitionNode) {
  const fragmentName = fragmentDefinition.name.value
  const underscoreIndex = fragmentName.lastIndexOf('_')

  if (underscoreIndex > 0 && underscoreIndex < fragmentName.length - 1) {
    return fragmentName.slice(underscoreIndex + 1)
  }

  const typename = fragmentDefinition.typeCondition.name.value

  return typename.charAt(0).toLowerCase() + typename.slice(1)
}

function isDataRef(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Creates a Cell out of a GraphQL fragment and components that render its
 * data.
 *
 * Fragment Cells don't fire queries of their own. A parent Cell spreads the
 * fragment in its QUERY and passes the matching slice of the query result
 * down via a prop named after the fragment (`AuthorCell_author` -> `author`).
 * `Success` receives the data as that same prop. The data is read
 * synchronously, so fragment Cells never render `Loading`.
 *
 * When the GraphQL client supports it (Apollo does), the fragment data is
 * read from the client's cache, so the Cell re-renders when other queries or
 * mutations update the underlying entity. If the cache read is incomplete,
 * the passed-in object itself is used as the data snapshot.
 */
export function createFragmentCell<
  CellProps extends Record<string, unknown>,
  CellVariables extends Record<string, unknown>,
>({
  FRAGMENT,
  afterQuery = (data) => data,
  isEmpty = isDataEmpty,
  Empty,
  Success,
  displayName = 'Cell',
}: CreateCellProps<CellProps, CellVariables>): React.FC<CellProps> {
  if (!FRAGMENT) {
    throw new Error(
      `createFragmentCell() for ${displayName} requires a FRAGMENT`,
    )
  }

  // Assigning to a `const` here (as opposed to using the destructured
  // variable directly) makes the `!FRAGMENT` narrowing above hold inside
  // `NamedCell` below
  const fragment = FRAGMENT

  const fragmentDefinition = getFragmentDefinition(fragment, displayName)
  const fragmentName = fragmentDefinition.name.value
  const propName = getFragmentPropName(fragmentDefinition)

  // Registering the fragment makes it possible for parent Cells to spread it
  // in their QUERY by name, without having to interpolate the fragment
  // document. Registration happens when the Cell module is imported, which is
  // always before the parent (which imports the Cell to render it) fires its
  // query.
  fragmentRegistry.register(fragment)

  function NamedCell(props: React.PropsWithChildren<CellProps>) {
    const { children: _, [propName]: rawSlice, ...rest } = props

    const dataRef = isDataRef(rawSlice) ? rawSlice : undefined

    const fragmentResult = useFragment({
      fragment,
      fragmentName,
      from: dataRef ?? {},
    })

    if (!(propName in props)) {
      throw new Error(
        `${displayName} must be passed a \`${propName}\` prop. Render it ` +
          `from a parent Cell that spreads \`...${fragmentName}\` in its ` +
          `QUERY, and pass the matching data object: ` +
          `\`<${displayName} ${propName}={data.someField} />\``,
      )
    }

    // Prefer the live cache read. Fall back to the data snapshot passed in
    // via the prop when the cache can't provide a complete result (e.g. when
    // prerendering, in tests, or with GraphQL clients without `useFragment`
    // support). A slice that is null (a nullable field, or a partial error
    // with `errorPolicy: 'all'`) stays null and renders `Empty` below.
    const data = fragmentResult.complete
      ? fragmentResult.data
      : (dataRef ?? null)

    const afterQueryData = afterQuery({ [propName]: data })

    if (isEmpty({ [propName]: data }, { isDataEmpty }) && Empty) {
      return <Empty {...rest} {...afterQueryData} />
    }

    return <Success {...rest} {...afterQueryData} />
  }

  NamedCell.displayName = displayName

  return (props: CellProps) => {
    return <NamedCell {...props} />
  }
}
