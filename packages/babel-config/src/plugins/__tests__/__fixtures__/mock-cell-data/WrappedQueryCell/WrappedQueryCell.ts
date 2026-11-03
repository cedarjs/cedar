import type { TypedDocumentNode } from '@cedarjs/web'

declare function graphql(source: string): TypedDocumentNode

export const QUERY = graphql(
  'query FindWrappedUser { user { id } }',
) as TypedDocumentNode<{ user: { id: number } }, Record<string, never>>

export const Success = () => null
