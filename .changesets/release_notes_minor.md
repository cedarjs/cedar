## .cedar/

Cedar apps now default to a top level `.cedar/` directory for generated types,
GraphQL schema, and other transitory data

With both a `cedar.toml` file and a `.cedar/` directory it should be much more
clear to those working on the app that it's a Cedar app and nothing else.

## `ctx.query` is now a `URLSearchParams`

Cedar's `handle` function receives `ctx.query` as a standard web-platform
[`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)
instead of a flat `Record<string, string>`. This gives you multi-value support,
iteration, and serialisation for free — no extra dependencies needed.

### Migrating from the legacy `handler`

Legacy `handler` functions receive `event.queryStringParameters` parsed by
picoquery, which expands bracket notation into arrays and nested objects. The
table below shows the equivalent using `ctx.query`.

| Raw query string           | Legacy `handler`                                             | Cedar `handle`                                       |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `?page=1`                  | `event.queryStringParameters.page` → `'1'`                   | `ctx.query.get('page')` → `'1'`                      |
| `?tag=cedar&tag=framework` | `event.queryStringParameters.tag` → `['cedar', 'framework']` | `ctx.query.getAll('tag')` → `['cedar', 'framework']` |
| `?ids[]=1&ids[]=2`         | `event.queryStringParameters.ids` → `['1', '2']`             | `ctx.query.getAll('ids[]')` → `['1', '2']`           |
| `?user[name]=alice`        | `event.queryStringParameters.user.name` → `'alice'`          | `ctx.query.get('user[name]')` → `'alice'`            |

The key difference with bracket notation is that `URLSearchParams` preserves the
raw key name literally — `ids[]=1` is stored under the key `'ids[]'`, not `'ids'`.
For the common case of plain flat parameters the migration is a straightforward
swap: `event.queryStringParameters.foo` → `ctx.query.get('foo')`.

### Not ready to migrate? Use picoquery directly

If you rely heavily on bracket-notation parsing and can't migrate yet, you can
reproduce the legacy behaviour inside a `handle` function by parsing `request.url`
with picoquery yourself:

```js
import { parse } from 'picoquery'

export const handle = async (request, ctx) => {
  const rawSearch = new URL(request.url).search
  const query = parse(rawSearch ? rawSearch.slice(1) : '', {
    nestingSyntax: 'index',
    arrayRepeat: true,
    arrayRepeatSyntax: 'bracket',
  })

  // query.ids        → ['1', '2']   for ?ids[]=1&ids[]=2
  // query.user.name  → 'alice'      for ?user[name]=alice
  // query.page       → '1'          for ?page=1
}
```
