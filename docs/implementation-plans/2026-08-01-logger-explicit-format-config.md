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
exact API shape is still open; see **Open decision: A vs B vs C vs D**.

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

**The API shape is not settled.** Four candidates are live, and a decision
between them is a prerequisite for implementation — see
**Open decision: A vs B vs C vs D** below. Everything else in this plan (the
dependency-free formatter, the standalone package, what gets deleted, the
migration, the conditions) holds regardless of which is chosen.

### Candidate A — a `format` option

```ts
import { createLogger } from '@cedarjs/api/logger'

export const logger = createLogger({ format: 'auto' })
```

- `'pretty'` — always pretty-print
- `'json'` — always raw NDJSON
- `'auto'` (default) — pretty in development, JSON otherwise

`@cedarjs/api` resolves the formatter lazily, by string, only when `format`
actually resolves to `'pretty'`. This is precisely the pino/`pino-pretty` model:
pino declares `pino-pretty` as a **devDependency** — not a dependency, not a
peer — and users write `transport: { target: 'pino-pretty' }`, a string pino
resolves at runtime (that is what pino's `real-require` dependency is for). If
it is missing you get a clear resolution error; if you never ask for pretty it is
never touched.

The cost of a string reference is that static analysis cannot see it — see
**The devDependency trilemma** below.

### Candidate B — the app depends on the formatter directly

```ts
import { createLogger, isDevelopment } from '@cedarjs/api/logger'
import { prettyDestination } from '@cedarjs/log-formatter'

export const logger = createLogger({
  destination: isDevelopment ? prettyDestination() : undefined,
})
```

`@cedarjs/log-formatter` appears in the app's own `api/package.json` — see
**The formatter as a standalone package** below for why that matters.

One trap to avoid: it must be a regular dependency, **not** a devDependency. The
api build runs esbuild with `bundle: false`
(`packages/internal/src/build/api.ts`), so the static import survives into
`api/dist` and throws `MODULE_NOT_FOUND` at runtime in production, where
devDependencies are not installed.

### Candidate C — a dynamic import in app code

```ts
import { createLogger, isDevelopment } from '@cedarjs/api/logger'

const { prettyDestination } = isDevelopment
  ? await import('@cedarjs/log-formatter')
  : { prettyDestination: undefined }

export const logger = createLogger({ destination: prettyDestination?.() })
```

The only shape that lets the formatter stay a **devDependency** while remaining
visible to static analysis — see **The devDependency trilemma** below.

Its cost is top-level await, which makes `logger.ts` an async module and
propagates to `db.ts`, `graphql.ts`, and every service transitively. The classic
failure mode for that — a CJS `require()` of an async ESM module — cannot occur
in an ESM-only Cedar, which is the world this plan targets. **Unverified:**
whether TLA in the api module graph survives `ssrLoadModule()` in the dev
middleware, and whether the universal-deploy build (which bundles, unlike the
esbuild `bundle: false` path) handles it. Answerable with an experiment; must be
settled before C can be chosen.

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

Mechanically identical to B, except `@cedarjs/api` re-exports
`prettyDestination` so the formatter arrives transitively and the app's manifest
stays unchanged.

`isDevelopment`, `isProduction`, and `isTest` are already exported from
`@cedarjs/api/logger` (`index.ts:44-60`), so this introduces no new
environment-detection surface.

Under all four candidates, an explicitly supplied `destination` wins over any
framework default, matching the precedence the interception plugin already uses
(`vite-plugin-cedar-log-formatter-dev.ts:100`).

### The devDependency trilemma

The formatter is meant to be used in development, or standalone via `dlx` in
production — not as something an app ships and runs. Making the manifest say
that turns out to constrain the API shape, because you can have at most two of:

1. **devDependency** — the declaration matches the intent
2. **Statically analyzable** — no false "unused dependency" from knip and
   friends
3. **Production-safe** — no `MODULE_NOT_FOUND` when devDependencies are absent

|                                        |  1  |  2  |  3  |
| -------------------------------------- | :-: | :-: | :-: |
| Static import + `dependency` (B, D)    |  ✗  |  ✓  |  ✓  |
| String reference + devDependency (A)   |  ✓  |  ✗  |  ✓  |
| Static import + devDependency          |  ✓  |  ✓  |  ✗  |
| **Dynamic import + devDependency (C)** |  ✓  |  ✓  |  ✓  |

Verified empirically against knip 6.24: given a static import, an
`await import('pkg')`, and a bare `'pkg'` string, only the bare string was
reported as an unused dependency. Dynamic imports with literal specifiers are
resolved; strings are not.

One constraint falls out of this: the dynamic import has to be in **app code**.
If `@cedarjs/api` performs it internally, the app's devDependency still has zero
references within the app and knip flags it regardless — so this is C
specifically, not A with a lazy import.

**Promotion is the escape valve for staging.** If an app wants pretty logs
outside development, it moves `@cedarjs/log-formatter` from `devDependencies` to
`dependencies` and changes the condition. The manifest field is the declaration
of intent, and changing intent means changing the field — rather than trying to
find one declaration that covers both.

### Open decision: A vs B vs C vs D

All four are explicit at the call site and type-discoverable. They differ in
where the dev/prod decision lives, how the formatter is declared, and what that
costs.

|                                                       | A (`format`)                      | B (app-level dep)                          | C (dynamic import)                         | D (re-exported)                            |
| ----------------------------------------------------- | --------------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| Env check                                             | inside the framework              | in app code                                | in app code                                | in app code                                |
| Hidden behaviour                                      | `'auto'` expands to pretty-in-dev | none                                       | none                                       | none                                       |
| Customising                                           | new enum members Cedar must add   | arguments to `prettyDestination()`         | arguments to `prettyDestination()`         | arguments to `prettyDestination()`         |
| Non-standard cases (pretty in staging, tee to a file) | not expressible                   | change the condition                       | promote dep, change the condition          | change the condition                       |
| Boilerplate per app                                   | none                              | one conditional, apps can get subtly wrong | one conditional, apps can get subtly wrong | one conditional, apps can get subtly wrong |
| Declared as                                           | devDependency                     | dependency                                 | devDependency                              | transitive via `@cedarjs/api`              |
| Survives static analysis                              | no — knip flags it unused         | yes                                        | yes                                        | n/a (not in app manifest)                  |
| In the app's `api/package.json`                       | yes                               | yes                                        | yes                                        | no                                         |
| Async `logger.ts`                                     | no                                | no                                         | **yes** — TLA propagates                   | no                                         |

The case for **A** is that the env check is the kind of thing a framework should
get right once rather than have every app restate —
`process.env.NODE_ENV === 'development'` is not the same as Cedar's
`isDevelopment`, which also excludes test, and apps will write the former. It
also has the strongest precedent: this is what pino does.

The case for **B** is everything in **The formatter as a standalone package**
below: if the formatter is a package people can choose, uninstall, and run
standalone, the app manifest is where that choice should be visible. Its cost is
declaring a runtime `dependency` for something intended for development.

The case for **C** is that it is the only shape satisfying all three corners of
the trilemma. Its cost is top-level await, and it is the only candidate with an
open feasibility question attached.

The case for **D** is that it has no hidden behaviour and adds nothing to the
app's manifest — the formatter is there because Cedar's logger needs it, which
is arguably what it is. It is also the only candidate that forgoes the
standalone-package signalling entirely.

They are not mutually exclusive: `format` is sugar over `prettyDestination()`,
and B, C, and D differ mainly in import mechanics, so shipping more than one is
cheap. If several ship, the remaining question is which the template scaffolds,
since that is what most apps will carry forever.

**This must be decided before implementation starts.** It determines the codemod
output, the template, and the docs, and it is the hardest part of the change to
revise afterwards.

---

## The unlock: a dependency-free formatter

PR #2140 rejected adding `@cedarjs/api-server` or `@cedarjs/internal` as a
dependency of `@cedarjs/api`, on the grounds that `@cedarjs/api` ships in every
deployed api and is deliberately held to `pino`, `@prisma/client`,
`jsonwebtoken`, and a few small utilities. That reasoning is sound and still
applies.

What was never evaluated is whether the formatter could stand alone with **no
dependencies at all**. The current formatter
(`packages/api-server/src/logFormatter/`) needs four:

| Dependency        | Replacement                                          |
| ----------------- | ---------------------------------------------------- |
| `ansis`           | ANSI escape strings — no library needed              |
| `pretty-bytes`    | ~10 lines                                            |
| `fast-json-parse` | `JSON.parse` in a try/catch                          |
| `split2`          | unnecessary once receiving whole lines, not a stream |

So the target is roughly 200 lines of dependency-free code. That is noise next
to pino itself, and it dissolves the footprint constraint rather than working
around it — a zero-dependency formatter is a categorically different proposition
from `@cedarjs/internal`'s 193 dependency entries, which is what #2140 was
actually rejecting.

---

## The formatter as a standalone package

Extract the formatter to `@cedarjs/log-formatter` — a scoped package in this
monorepo, published alongside everything else.

The technical case is thin on its own: every framework consumer already has
`@cedarjs/api` in its graph, so nothing internal is unblocked. The case rests on
two things the current arrangement genuinely cannot do.

### It makes the bin usable off-box

`cedar-log-formatter` is currently one of ~20 bins on `@cedarjs/core`, which
pulls `@cedarjs/internal` transitively — typescript, esbuild, vite, the codegen
toolchain. There is no realistic way to invoke it on a machine that isn't a
Cedar app checkout. In practice that means reaching into `node_modules` by
absolute path:

```bash
journalctl --user -u my-api --no-pager -o cat --since "10 min ago" \
  | node /var/www/my-app/current/node_modules/@cedarjs/core/dist/bins/cedar-log-formatter.js
```

As its own zero-dependency package with a `bin` entry, the same thing becomes:

```bash
journalctl --user -u my-api --no-pager -o cat --since "10 min ago" \
  | yarn dlx @cedarjs/log-formatter
```

No install, no Cedar app required. This is the "format output from a process you
didn't configure" case that already justifies keeping the bin at all — reading
pino logs captured by systemd is a real production workflow, and today the tool
is effectively unreachable there.

The dependency-free work above is what makes this viable: `dlx` of a ~200-line
zero-dep package is near-instant.

### It signals that the formatter is optional

A package in the app's `api/package.json` is a visible, removable choice.
Bundled inside `@cedarjs/api` it is an implementation detail nobody can decline.
"Don't want it? Don't install it" is only a real offer if there is something to
not install.

This is also the argument for candidate B over D — B is the candidate where that
choice appears in the app's own manifest.

### It is pitchable on its own

The formatter's differentiator against `pino-pretty`, the incumbent, is that it
is **GraphQL-aware**: operation name, query, result data, response cache, and
tracing extensions all get dedicated formatters (`formatters.ts`). The
addressable audience is anyone running a pino-based GraphQL server, not only
Cedar users.

### Costs

- A published package API is a long-term contract. An internal module inside
  `@cedarjs/api` can be reshaped freely; `@cedarjs/log-formatter@1` cannot.
- One more package in every release, changeset, and dedupe pass.
- Under A or D, `@cedarjs/api` gains a dependency edge on it. Thin and
  zero-dependency, but a real edge that did not exist before.

---

## What this deletes

- `packages/vite/src/plugins/vite-plugin-cedar-log-formatter-dev.ts` and its
  tests
- its registration in `packages/vite/src/apiDevMiddleware.ts`
- the `@cedarjs/vite` → `@cedarjs/api-server` dependency edge (verified: the log
  formatter is its only consumer in `packages/vite/src`)
- the shell pipe in `devHandler.ts:404`
- the shell pipe in `jobsHandler.ts:36`

**Keep** the `cedar-log-formatter` bin, moved to `@cedarjs/log-formatter`.
Formatting output from a process you didn't configure — `cedar serve |`, or a
journalctl pipe on a production box — is a real workflow, and moving the bin is
what makes it reachable off-box. The `@cedarjs/core` bin entry can stay as an
alias so existing muscle memory keeps working.

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
