# Logger: Explicit Format Config in `createLogger()`

- **Date:** 2026-08-01
- **Author:** Tobbe
- **Status:** Proposal
- **Target:** Future major

Follow-on to
[2026-07-20-ud-dev-log-formatting.md](../implementation-docs/2026-07-20-ud-dev-log-formatting.md)
(PR #2140), which fixed pretty-printed api logs under `cedar dev --ud` via
dev-only Vite resolver interception. That fix is correct for what it was scoped
to. This plan proposes replacing it — along with two shell pipes — with explicit
configuration at the `createLogger()` call site, as part of a major version. The
exact API shape is still open; see **Open decision: A vs D**.

---

## Background

Cedar wires up api log formatting in three separate places today, using two
different mechanisms, depending on how the process was started:

| Path             | Mechanism                                           | Where                                                              |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `cedar dev`      | shell pipe into `cedar-log-formatter`               | `packages/cli/src/commands/dev/devHandler.ts:404`                  |
| `cedar jobs`     | shell pipe into `cedar-log-formatter`               | `packages/cli/src/commands/jobsHandler.ts:36`                      |
| `cedar dev --ud` | Vite resolver interception of `@cedarjs/api/logger` | `packages/vite/src/plugins/vite-plugin-cedar-log-formatter-dev.ts` |

Each is locally defensible — the `--ud` doc walks through in detail why the pipe
could not be reused there. The formatter itself is shared, so this is not three
implementations of formatting. What is triplicated is the wiring: three sites
that decide whether formatting happens at all, three things to keep in sync when
that decision changes, three paths to test. And in the `--ud` case the wiring is
invisible from app code — nothing in the project explains why its logs come out
pretty.

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

Move the decision about whether logs are formatted out of the build/dev tooling
and into `createLogger()` (`packages/api/src/logger/index.ts`), so it is
configured once, in app code, and applies identically to every way the api can
be started.

**The API shape is not settled.** Two candidates are live, and a decision
between them is a prerequisite for implementation — see **Open decision: A vs D**
below. Everything else in this plan (the dependency-free formatter, what gets
deleted, the migration, the conditions) holds either way.

### Candidate A — a `format` option

```ts
import { createLogger } from '@cedarjs/api/logger'

export const logger = createLogger({ format: 'auto' })
```

- `'pretty'` — always pretty-print
- `'json'` — always raw NDJSON
- `'auto'` (default) — pretty in development, JSON otherwise

### Candidate D — an exported destination factory

```ts
import {
  createLogger,
  isDevelopment,
  prettyDestination,
} from '@cedarjs/api/logger'

export const logger = createLogger({
  destination: isDevelopment ? prettyDestination() : undefined,
})
```

`isDevelopment`, `isProduction`, and `isTest` are already exported from
`@cedarjs/api/logger` (`index.ts:44-60`), so this introduces no new
environment-detection surface.

Under both candidates, an explicitly supplied `destination` wins over any
framework default, matching the precedence the interception plugin already uses
(`vite-plugin-cedar-log-formatter-dev.ts:100`).

### Two variants that were considered and dropped

**B: A separate `@cedarjs/log-formatter` package as an app devDependency** — the
literal reading of the `--ud` doc's option 5. The api build runs esbuild with
`bundle: false` (`packages/internal/src/build/api.ts`), so a static
`import { prettyDestination } from '@cedarjs/log-formatter'` in `logger.ts`
survives into `api/dist` and throws `MODULE_NOT_FOUND` in production, where
devDependencies are not installed. Making it a regular dependency instead would
work, but D achieves the same thing with no new package at all.

**C: A guarded dynamic import in app code** — avoids the above, but top-level
await makes `logger.ts` an async module, and it is imported by `db.ts`,
`graphql.ts`, and every service transitively. Real propagation cost for no
benefit over D.

### Open decision: A vs D

Both are explicit at the call site and type-discoverable. Both leave the
formatter and its loading inside `@cedarjs/api`. They differ in where the
dev/prod decision lives.

|                                                       | A (`format`)                      | D (`prettyDestination`)                          |
| ----------------------------------------------------- | --------------------------------- | ------------------------------------------------ |
| Env check                                             | inside the framework              | in app code, one visible line                    |
| Hidden behaviour                                      | `'auto'` expands to pretty-in-dev | none                                             |
| Customising                                           | new enum members Cedar must add   | arguments to `prettyDestination()`               |
| Non-standard cases (pretty in staging, tee to a file) | not expressible                   | change the condition, wrap the destination       |
| Boilerplate per app                                   | none                              | one conditional, which apps can get subtly wrong |
| Formatter loaded in production                        | avoidable via lazy subpath        | imported eagerly (~200 dep-free lines)           |

The case for A is that the env check is the kind of thing a framework should get
right once rather than have every app restate — `process.env.NODE_ENV === 'development'`
is not the same as Cedar's `isDevelopment`, which also excludes test, and apps
will write the former.

The case for D is that it has no hidden behaviour at all, composes without
requiring API additions, and reuses exports that already exist.

They are not mutually exclusive: `format` is sugar over `prettyDestination()`,
so shipping both is cheap. If both ship, the remaining question is only which
one the template scaffolds, since that is what most apps will carry forever.

**This must be decided before implementation starts.** It determines the codemod
output, the template, and the docs, and it is the hardest part of the change to
revise afterwards.

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

## Loose end: retire the "transport stream" warning

`createLogger()` emits a one-time
`console.warn('Logs will be sent to the transport stream in the current development environment.')`
whenever it is handed a stream `destination` in development
(`packages/api/src/logger/index.ts:234-239`). #2140 documents this firing on
every `--ud` session as a known cosmetic side effect, left alone at the time
because suppressing it would have meant teaching `@cedarjs/api` about a dev-only
detail from another package.

It should be deleted as part of this work. The reasoning needs the history.

### Where it came from

It arrived with the original logger implementation — RedwoodJS #1937, David
Thyresson, March 2021 — as one of **three** warnings that only make sense
together:

```js
if (isFile) {
  if (!isDevelopment) {
    console.warn(
      'Please make certain that file system access is available when logging to a file in a non-development environment.'
    )
  }
} else {
  if (isStream && isDevelopment && !isTest) {
    console.warn(
      'Logs will be sent to the transport stream in the current development environment.'
    )
  }
  if (isStream && options.prettyPrint) {
    console.warn(
      'Logs sent to the transport stream are being prettified. This format may be incompatible.'
    )
  }
}
```

That commit describes `destination` as being one of three things — "file,
stdout, or remote transport stream" — with an explicit goal to "stream to
third-party log and application monitoring services vital to production logging
in serverless environments like logFlare and Datadog." Each warning guards a
misuse of one of those:

1. **File outside dev** — serverless has no writable filesystem.
2. **Stream in dev** — your local logs are going to Datadog/Logflare instead of
   your terminal.
3. **Stream + prettyPrint** — ANSI colour would corrupt a remote ingestion
   format.

The load-bearing assumption is in the wording: "the **transport** stream." pino
had no worker `transport` option until pino 7, later that same year, so passing
a writable stream as `destination` was _the_ mechanism for shipping logs
off-box. Stream destination effectively meant remote.

### Why it no longer holds

That assumption is now false twice over. pino has had a real `transport` option
for years, so a stream `destination` implies nothing about where logs go. And
under either candidate in this plan, the most common stream destination in
development is Cedar's own pretty-printer writing to **stdout** — the exact
opposite of what the warning describes. It would announce that logs are being
shipped to a remote service while pointing at the thing putting them in the
terminal. Not merely noisy; inverted.

There is precedent for retiring these. Warning 3 is already gone, deleted when
pino dropped `prettyPrint`. Warning 1 was tightened from `!isDevelopment` to
`isProduction`. These have been eroding as the 2021 model of `destination`
stopped holding, and warning 2 is the last one whose premise has expired.

### What deletion buys

The branch it lives in exists only to produce warnings — both arms return an
identical `pino(options, stream)` call. Removing warning 2 collapses the whole
`isFile`/`isStream` structure to a single call plus warning 1, which stays: "no
filesystem in production" is still true and still catches a real deployment
mistake.

Note this is not resolved by candidate A's ability to distinguish
framework-supplied from app-supplied destinations. Under D the app genuinely
does pass a custom destination, so no such distinction exists. Deletion is the
answer under both, and if the warning were to be kept under D it would need
`prettyDestination()` to return a branded value for `createLogger` to recognise
— roughly three lines, to preserve a warning whose premise has expired.
