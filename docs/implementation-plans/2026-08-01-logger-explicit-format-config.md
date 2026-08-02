# Logger: Explicit Format Config in `createLogger()`

- **Date:** 2026-08-01
- **Author:** Tobbe
- **Status:** Proposal
- **Target:** Future major

Follow-on to
[2026-07-20-ud-dev-log-formatting.md](../implementation-docs/2026-07-20-ud-dev-log-formatting.md)
(PR #2140), which fixed pretty-printed api logs under `cedar dev --ud` via
dev-only Vite resolver interception. That fix is correct for what it was scoped
to. This plan proposes replacing it — along with two shell pipes — with a single
explicit option on `createLogger()`, as part of a major version.

---

## Background

Cedar formats api logs three different ways today, depending on how the process
was started:

| Path             | Mechanism                                           | Where                                                              |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `cedar dev`      | shell pipe into `cedar-log-formatter`               | `packages/cli/src/commands/dev/devHandler.ts:404`                  |
| `cedar jobs`     | shell pipe into `cedar-log-formatter`               | `packages/cli/src/commands/jobsHandler.ts:36`                      |
| `cedar dev --ud` | Vite resolver interception of `@cedarjs/api/logger` | `packages/vite/src/plugins/vite-plugin-cedar-log-formatter-dev.ts` |

Each is locally defensible — the `--ud` doc walks through in detail why the pipe
could not be reused there. But collectively they mean "how do my logs get
formatted" has three answers, a change to formatting behavior has to be made in
three places and tested three ways, and the `--ud` answer is invisible from app
code.

### Why the `--ud` mechanism in particular is a liability

The interception plugin depends on two Vite internals:

- `enforce: 'pre'` running before Vite's SSR externalization decides that a bare
  `node_modules` specifier should bypass the plugin pipeline
- the `importer` value passed to `resolveId`, used for the recursion guard

Both are internals, not contract. Cedar is on Vite 7.3 with Rolldown on the
horizon. If either shifts, the failure mode is not an error — it is raw pino
NDJSON in dev and a confused bug report.

---

## Proposal

Add an explicit format option to `createLogger()`
(`packages/api/src/logger/index.ts`):

```ts
export const logger = createLogger({ format: 'auto' })
```

- `'pretty'` — always pretty-print
- `'json'` — always raw NDJSON
- `'auto'` (default) — pretty in development, JSON otherwise

An explicitly supplied `destination` continues to win over `format`, matching
the precedence the interception plugin already uses
(`vite-plugin-cedar-log-formatter-dev.ts:100`).

### Why this shape rather than the app importing a formatter

The `--ud` doc's option 5 was "have the app's `api/src/lib/logger.ts` construct
a dev-only formatting destination itself, with the formatter as a devDependency
of the app's own `api/package.json`." Written literally, that has a sharp edge:
the api build runs esbuild with `bundle: false`
(`packages/internal/src/build/api.ts`), so a static
`import { devFormatter } from '@cedarjs/log-formatter'` in `logger.ts` survives
into `api/dist` and throws `MODULE_NOT_FOUND` at runtime in production, where
devDependencies aren't installed. Avoiding that means a guarded dynamic import
in app code, which is ugly enough to undercut the point of being explicit.

Passing a `format` string instead keeps the call site explicit and
type-discoverable while leaving the formatter, the environment check, and the
lazy loading inside `@cedarjs/api`, where they can be got right once.

This is still "implicit" in the sense that `'auto'` resolves to pretty-in-dev.
That is a documented default of a function the app deliberately calls, which is
a different category from rewriting module resolution behind the app's back.

---

## The unlock: a dependency-free formatter in `@cedarjs/api`

PR #2140 rejected adding `@cedarjs/api-server` or `@cedarjs/internal` as a
dependency of `@cedarjs/api`, on the grounds that `@cedarjs/api` ships in every
deployed api and is deliberately held to `pino`, `@prisma/client`,
`jsonwebtoken`, and a few small utilities. That reasoning is sound and still
applies.

What was never evaluated is whether the formatter could live in `@cedarjs/api`
with **no new dependencies at all**. The current formatter
(`packages/api-server/src/logFormatter/`) needs four:

| Dependency        | Replacement                                          |
| ----------------- | ---------------------------------------------------- |
| `ansis`           | ANSI escape strings — no library needed              |
| `pretty-bytes`    | ~10 lines                                            |
| `fast-json-parse` | `JSON.parse` in a try/catch                          |
| `split2`          | unnecessary once receiving whole lines, not a stream |

So the target is roughly 200 lines of dependency-free code in `@cedarjs/api`.
That is noise next to pino itself, and it dissolves the footprint constraint
rather than working around it.

Expose it on a subpath (e.g. `@cedarjs/api/logger/format`) so the module is only
loaded when `format` actually resolves to `'pretty'`.

---

## What this deletes

- `packages/vite/src/plugins/vite-plugin-cedar-log-formatter-dev.ts` and its
  tests
- its registration in `packages/vite/src/apiDevMiddleware.ts`
- the `@cedarjs/vite` → `@cedarjs/api-server` dependency edge (verified: the log
  formatter is its only consumer in `packages/vite/src`)
- the shell pipe in `devHandler.ts:404`
- the shell pipe in `jobsHandler.ts:36`

**Keep** the `cedar-log-formatter` bin. `cedar serve | cedar-log-formatter` is a
legitimate affordance for formatting output from a process you didn't configure,
and it costs nothing to leave in place.

---

## Constraint carried forward from #2140

Whatever implements `'pretty'` **must format in-process, on the main thread.**
The postscript in the #2140 doc records why: a pino worker-thread transport —
the idiomatic-looking alternative — loses buffered output when the process
exits, including the `logger.fatal()` line immediately before an uncaught throw
(lost 3/3 runs; `sync: true` and `flushSync()` both fail to help). The plain
`{ write() }` destination the current plugin injects survives 3/3. Reuse that
shape.

---

## Migration

The app-visible change is one line in one file at a known path,
`api/src/lib/logger.ts`, which is close to the most codemoddable change
available.

Open questions for the codemod:

- Apps that customized `logger.ts` need their variants handled. Mitigating
  factor: customized loggers are disproportionately likely to already pass an
  explicit `destination`, which the precedence rule leaves alone.
- Apps that skip the codemod get raw NDJSON in dev and will read it as a
  regression. Consider keeping the interception plugin for one major as a
  detect-and-warn fallback, rather than deleting it in the same release.

---

## Conditions

**1. All-or-nothing.** If explicit config replaces the Vite plugin but
`cedar dev` and `cedar jobs` keep their pipes, the result is strictly worse than
today: an app-visible migration bought in exchange for still having three code
paths. The entire win is the collapse to one.

**2. Ride the ESM-only major.** See
[2026-07-25-esm-migration.md](./2026-07-25-esm-migration.md). That release
already asks apps to migrate, already runs a codemod pass, already carries
breaking-change notes. A standalone major that changes one line in `logger.ts`
is hard to justify to users; the same change bundled in costs them nothing
extra.

---

## Loose end worth fixing along the way

`createLogger()` currently emits a one-time
`console.warn('Logs will be sent to the transport stream in the current development environment.')`
whenever it is handed a stream `destination` in development
(`packages/api/src/logger/index.ts:234-239`). #2140 documents this firing on
every `--ud` session as a known cosmetic side effect, left alone because
suppressing it would have meant teaching `@cedarjs/api` about a dev-only detail
from another package.

Under this design that reason disappears — `@cedarjs/api` owns the formatting
path, so it can distinguish "the app configured a custom destination" from "we
resolved `format: 'auto'` to pretty" and only warn for the former.
