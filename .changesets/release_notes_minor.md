## Deprecations

- **The `skip` option on `useQuery` and `useSubscription` is deprecated.**
  Apollo Client 4.3 deprecates `skip` in favor of `skipToken`, which is more
  type-safe: passing `skipToken` as the whole options argument, instead of
  `{ skip: true, variables: {...} }`, lets TypeScript narrow `data` to
  `undefined` when the query is skipped. `skip` still works and Cedar makes
  no changes of its own here — this only calls out Apollo's own deprecation
  for projects that upgrade.

  ```tsx
  import { skipToken } from '@apollo/client/react'
  import { useQuery } from '@cedarjs/web'

  const { data } = useQuery(query, id ? { variables: { id } } : skipToken)
  ```

  `@cedarjs/web` doesn't re-export `skipToken` itself, so import it directly
  from `@apollo/client/react`. See Apollo's
  [`skipToken` docs](https://www.apollographql.com/docs/react/api/react/hooks#skiptoken)
  for the full API.
