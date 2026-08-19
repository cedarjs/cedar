import React from 'react'

import type { OperationVariables } from '@apollo/client'
import type { DocumentNode, FragmentDefinitionNode } from 'graphql'
import { Kind } from 'graphql'

import { fragmentRegistry, useFragment } from '../../apollo/fragmentRegistry.js'

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
  CellVariables extends OperationVariables = OperationVariables,
  GQLResult = any,
>({
  FRAGMENT,
  afterQuery = (data) => data,
  isEmpty = isDataEmpty,
  Empty,
  Success,
  displayName = 'Cell',
}: CreateCellProps<CellProps, CellVariables, GQLResult>): React.FC<CellProps> {
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

    // `rest` is typed as `Omit<PropsWithChildren<CellProps>, string>` because
    // `propName` is only known at runtime, not as a string literal type --
    // TS can't tell which key was destructured out, so it conservatively
    // omits every string key. At runtime `rest` does hold the remaining
    // `CellProps`, so this reflects that.
    const restProps = rest as Partial<CellProps>

    // `Empty`/`Success` are checked against this Cell's real `GQLResult` and
    // `CellVariables` at its own call site. Inside this generic factory
    // function those are still abstract, and there's no way for TS to verify
    // structurally that `restProps`/`afterQueryData` line up with them, so
    // the merged props are asserted here rather than checked (see the same
    // pattern, with more detail, in createCell.tsx)
    const successProps = { ...restProps, ...afterQueryData }

    if (isEmpty({ [propName]: data }, { isDataEmpty }) && Empty) {
      return <Empty {...(successProps as any)} />
    }

    return <Success {...(successProps as any)} />
  }

  NamedCell.displayName = displayName

  return (props: CellProps) => {
    return <NamedCell {...props} />
  }
}
