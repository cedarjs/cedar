/**
 * Whether an extracted Apollo cache state is non-empty and worth inlining
 * into the prerendered HTML as a bootstrap `<script>`.
 *
 * Only emit the Apollo state bootstrap when there is state to restore. Both
 * consumers (`CedarApolloProvider` and the suspense provider) already do
 * `.restore(globalThis?.__CEDAR__APOLLO_STATE ?? {})`, so an empty payload is
 * a no-op. It is still an inline `<script>` though, which every strict-CSP app
 * has to allow-list with a hash that goes stale whenever the payload changes.
 * A page that prerenders no Cells emits nothing.
 */
export function hasApolloState(
  state: unknown,
): state is Record<string, unknown> {
  return (
    typeof state === 'object' && state !== null && Object.keys(state).length > 0
  )
}
