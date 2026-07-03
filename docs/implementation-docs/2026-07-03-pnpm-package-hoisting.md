# PNPM Package Hoisting Issue

## Symptom

CI failed on `main` — 🔄 Package Manager Smoke Tests → `Run cedar test web`.

5 test files failing:

```
Error: You must register a useQuery hook via the `GraphQLHooksProvider`
Error: You must register a useMutation hook via the `GraphQLHooksProvider`
```

**Failing tests:**

- `WaterfallBlogPostCell.test.tsx`
- `WaterfallPage.test.tsx`
- `BlogPostPage.test.tsx`
- `ContactUsPage.test.tsx`
- `HomePage.test.tsx`

## Root Cause

Several CedarJS packages list singleton framework packages (`@cedarjs/web`,
`@cedarjs/router`, `@cedarjs/auth`) as regular `dependencies` instead of
`peerDependencies`. With pnpm's strict module isolation, this means the
consuming package gets its own private copy of these dependencies, creating
multiple module instances at runtime.

The smoke test failure surfaced through `@cedarjs/testing`:

1. **Inside `@cedarjs/testing`'s private scope** — where `MockProviders` sets up
   `GraphQLHooksProvider`
2. **In the host project's web package** — where `BlogPostsCell` reads
   `GraphQLHooksContext`

Since `React.createContext()` produces a unique object per module instance, the
provider from instance 1 is invisible to instance 2. The context read by
`BlogPostsCell` gets the default (throwing) value.

With yarn/npm, hoisting puts both imports into the same file on disk, so they
resolve to the same object. pnpm's isolation breaks that assumption.

### Relevant code

| File                                                                                                                                                                        | Role                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`packages/testing/package.json:121-128`](https://github.com/cedarjs/cedar/blob/main/packages/testing/package.json#L121-L128)                                               | `@cedarjs/web` in `dependencies` (should be `peerDependencies`) |
| [`packages/web/src/components/GraphQLHooksProvider.tsx:71`](https://github.com/cedarjs/cedar/blob/main/packages/web/src/components/GraphQLHooksProvider.tsx#L71)            | `React.createContext()` with throwing defaults                  |
| [`packages/web/src/components/GraphQLHooksProvider.tsx:74,79`](https://github.com/cedarjs/cedar/blob/main/packages/web/src/components/GraphQLHooksProvider.tsx#L74-L79)     | Throwing error messages seen in CI                              |
| [`packages/testing/src/web/MockProviders.tsx:4-5`](https://github.com/cedarjs/cedar/blob/main/packages/testing/src/web/MockProviders.tsx#L4-L5)                             | `MockProviders` imports from `@cedarjs/web` (gets private copy) |
| [`packages/web/src/components/GraphQLHooksProvider.tsx:156-167`](https://github.com/cedarjs/cedar/blob/main/packages/web/src/components/GraphQLHooksProvider.tsx#L156-L167) | `useQuery` reads `GraphQLHooksContext` (gets host-project copy) |

## Fix

For each affected package, move the singleton framework packages from
`dependencies` → `peerDependencies`, and add them to `devDependencies` so they
remain available for local development/testing in the monorepo:

| Package                | Moved from `dependencies` to `peerDependencies`                       | Added to `devDependencies`                         |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| `@cedarjs/testing`     | `@cedarjs/web`, `@cedarjs/router`, `@cedarjs/auth`                    | `@cedarjs/web`, `@cedarjs/router`, `@cedarjs/auth` |
| `@cedarjs/gqlorm`      | `@cedarjs/web`                                                        | `@cedarjs/web`                                     |
| `@cedarjs/ogimage-gen` | `@cedarjs/router`                                                     | `@cedarjs/router`                                  |
| `@cedarjs/prerender`   | `@cedarjs/web`, `@cedarjs/router`                                     | `@cedarjs/web`, `@cedarjs/router`                  |
| `@cedarjs/router`      | `@cedarjs/auth`                                                       | `@cedarjs/auth`                                    |
| `@cedarjs/web`         | `@cedarjs/auth`                                                       | `@cedarjs/auth`                                    |
| `@cedarjs/vite`        | `@cedarjs/web`, `@cedarjs/auth` (and added missing `@cedarjs/router`) | `@cedarjs/web`, `@cedarjs/router`, `@cedarjs/auth` |

This tells pnpm to use the host project's single installed copy rather than a
private one, ensuring `React.createContext()` returns the same object
everywhere.

These should be listed as `peerDependencies` only — not both `peerDependencies`
and `dependencies`. The dual-listing pattern was a pre-npm-v7 workaround so
consumers who forgot to install the peer dep would still get something, but it
never guaranteed a singleton and pnpm's strict isolation explicitly breaks it.
npm v7+ made this pattern obsolete by auto-installing peer deps.

This is also relevant when choosing a **Yarn linker**. We currently use the
`node-modules` linker, which hoists everything into a flat `node_modules` (just
like npm) and masks incorrect dependency declarations. The default PnP linker
and the `pnpm` linker both create strict package boundaries, meaning they would
produce the exact same errors if this dependency type isn't fixed.

## CI Runs

The 🔄 Package Manager Smoke Tests workflow has been failing consistently on
`main`:

| #   | Date   | URL                                                       |
| --- | ------ | --------------------------------------------------------- |
| #19 | Jul 3  | https://github.com/cedarjs/cedar/actions/runs/28643802319 |
| #18 | Jul 2  | https://github.com/cedarjs/cedar/actions/runs/28571527091 |
| #17 | Jul 1  | https://github.com/cedarjs/cedar/actions/runs/28502683635 |
| #16 | Jun 30 | https://github.com/cedarjs/cedar/actions/runs/28428346053 |
| #15 | Jun 29 | https://github.com/cedarjs/cedar/actions/runs/28359808185 |
| #14 | Jun 28 | https://github.com/cedarjs/cedar/actions/runs/28315429735 |
| #13 | Jun 27 | https://github.com/cedarjs/cedar/actions/runs/28281560707 |
| #12 | Jun 26 | https://github.com/cedarjs/cedar/actions/runs/28224363626 |
| #11 | Jun 25 | https://github.com/cedarjs/cedar/actions/runs/28154253823 |
| #10 | Jun 24 | https://github.com/cedarjs/cedar/actions/runs/28082572629 |
| #9  | Jun 23 | https://github.com/cedarjs/cedar/actions/runs/28010126547 |
| #8  | Jun 22 | https://github.com/cedarjs/cedar/actions/runs/27943394890 |
| #7  | Jun 21 | https://github.com/cedarjs/cedar/actions/runs/27898433561 |
| #6  | Jun 20 | https://github.com/cedarjs/cedar/actions/runs/27864529039 |

Every run from #6 onward has been failing — broken on `main` for ~2 weeks.

## Potential follow-up

The framework package fixes above make `@cedarjs/testing` (and others) declare
`@cedarjs/web`, `@cedarjs/router`, and `@cedarjs/auth` as `peerDependencies`. In
a Cedar app, those packages are normally installed in the `web` workspace, while
`@cedarjs/testing` is installed at the project root.

For pnpm, this means the root workspace now has **unmet peer dependencies**
unless the package manager auto-installs them (`auto-install-peers=true` is the
default in pnpm v7+, but not guaranteed). To make the dependency graph explicit
and avoid relying on auto-install behavior, consider adding these three packages
to the root `devDependencies` of:

- `__fixtures__/test-project/package.json`
- `__fixtures__/test-project-esm/package.json`
- `__fixtures__/test-project-pnpm/package.json`
- `packages/create-cedar-app/templates/ts/package.json`
- `packages/create-cedar-app/templates/esm-ts/package.json`

This ensures pnpm resolves the peer deps from the same copies the `web`
workspace uses, keeping the singleton intact.

## References

- [How peers are resolved — pnpm docs](https://pnpm.io/how-peers-are-resolved) —
  explains that peer dependencies are resolved from the host project, ensuring
  singleton behavior.
- [pnpm#2443 — "pnpm install with workspaces causes duplicate modules"](https://github.com/pnpm/pnpm/issues/2443)
  — same class of problem: shared singleton state broken by pnpm's isolation.
- [Peer dependencies in (P)NPM — DEV article](https://dev.to/timoschinkel/peer-dependencies-in-pnpm-4mo6)
  — broader explanation of the concept.
