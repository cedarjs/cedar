# Vitest web tests: remove per-file Routes evaluation and Cell-mock scanning

Plan for making web-side Vitest runs in Cedar apps cheap per test file. A user
migrating a 211-file web suite from Cedar CJS + Jest to Cedar ESM + Vitest saw
wall time go from 228s to 506s, with Vitest attributing 1039s (aggregate across
workers) to module import and 152s to setup. Their investigation, reproduced in
full in the [appendix](#appendix-the-users-investigation-verbatim), points at
`@cedarjs/testing/web`'s test wrapper. This document records what of that
diagnosis holds up against the source, what does not, and the fix.

## Verified root causes

Every web test file in a Cedar app runs in its own isolated module registry
(Vitest's default `isolate: true`; `packages/vite/src/lib/getMergedConfig.ts`
sets only `globals` and `environment` under `test`, so the default stands). Two
framework-owned costs are paid again in every one of those registries:

### 1. `Routes.tsx` is evaluated for every test file that touches `@cedarjs/testing/web`

- `packages/testing/src/web/index.ts` re-exports `customRender as render` and
  `export * from '@testing-library/react'`, and ES modules are evaluated whole,
  so importing _anything_ from `@cedarjs/testing/web` (`screen`, `waitFor`,
  `mockGraphQLQuery`, …) evaluates `customRender.tsx`.
- `customRender.tsx:11` has a top-level `import { MockProviders }`.
- `MockProviders.tsx:7` has a top-level import of `globRoutesImporter.js`, whose
  `import.meta.glob(['/src/Routes.{tsx,jsx}', '/Routes.{tsx,jsx}'], { eager: true })`
  evaluates the user's Routes file and everything it statically imports: every
  layout used in `<Set wrap={...}>`, `./auth`, and whatever those pull in. Pages
  are wrapped in `React.lazy` by `cedarRoutesAutoLoaderPlugin` and are never
  rendered by `MockRouter.Router` (which only walks the children and returns
  `null`), so page modules are _not_ loaded — the cost is the Routes file plus
  its static import graph.
- The only thing this evaluation is for is populating the `routes.*()` lookup
  table in `packages/testing/src/web/MockRouter.tsx:19-36` so that
  `routes.home()` works inside components under test.

The user's controlled experiment (appendix, screenshot 4) isolates this cost:
swapping Routes for an empty component cut a single `<Button/>` test from 4.85s
to 0.98s of import time and 7.7s to 3.6s wall.

### 2. The injected setup file globs the whole `web/src` tree and imports every Cell mock, per file

- `cedarVitestWebConfigPlugin()`
  (`packages/testing/src/web/vitest/vite-plugin-cedar-vitest-web-config.ts:17-28`)
  adds `vitest-web.setup.js` to `setupFiles` for every web test run. It is wired
  in unconditionally for `mode === 'test'` at `packages/vite/src/index.ts:104`.
- `vitest-web.setup.ts:8-20` runs, in `beforeAll` of every file:
  `findCellMocks(getPaths().web.src)` — a synchronous `fast-glob` walk of the
  entire web source tree (`packages/testing/src/web/findCellMocks.ts`) — then a
  dynamic `import()` of every discovered mock (each of which registers an MSW
  handler as a side effect, via `cedarMockCellDataPlugin`), then
  `startMSW('node')` (`await import('msw/node')` + `setupServer().listen()`).
- `afterEach` resets and re-registers handlers; `afterAll` closes the server.

This work is proportional to the size of the app (number of Cells), and is
repeated N times for N test files, regardless of whether a file renders anything
that issues a GraphQL query.

### Corrections to the user's diagnosis

The plan below is scoped by these, so they are worth stating explicitly:

- **Routes are not loaded twice.** `MockProviders.tsx:18` wraps
  `require('~__CEDAR__USER_ROUTES_FOR_MOCK')` in a try/catch. Under Vitest the
  `require` shim is Node's `createRequire`, which knows nothing about Vite
  aliases, so it throws `MODULE_NOT_FOUND` and `UserRoutes` falls back to an
  empty component. Verified with a probe test in `local-testing-project`:
  `require()` → `MODULE_NOT_FOUND`, `await import()` of the same specifier →
  resolves. Only `globRoutesImporter`'s eager glob does real work. The `require`
  branch and the test-mode alias in `getMergedConfig.ts:71-73` are dead under
  Vitest (Storybook has its own `MockProviders` and its own alias in
  `packages/storybook/src/preset.ts:60` and is unaffected by this plan).
- **There is no Jest path to compare against, and the Vitest route loading was
  deliberate.** Jest support was removed in #2500. While it existed, the Jest
  preset mapped `~__CEDAR__USER_ROUTES_FOR_MOCK` to `Routes.tsx` through
  `moduleNameMapper`, and the CJS build stubbed `import.meta.glob`; so under
  Jest, `MockProviders` _also_ evaluated the Routes file in every test file —
  through the `require` branch instead of the glob. `globRoutesImporter.ts`
  exists because `require` cannot see Vite aliases, so the Vitest path needed
  its own way to reach the same file. Both paths were intended, and both load
  Routes per file; the cost difference is that Vite transforms and ESM-evaluates
  the Routes static import graph inside each isolated module runner, where Jest
  served Babel-cached CJS through `require`. The "Jest did the same work more
  cheaply" framing is therefore historical and accurate, but not actionable: the
  relevant comparison is "what does a test file need" vs "what is it paying
  for".
- **The "Testing Library directly" comparison understates the win.** In that
  measurement (appendix, screenshot 2) the setup file still ran, so Cell/MSW
  cost stayed constant and only the Routes cost moved. Fixing both causes
  compounds.
- **`local-testing-project` does not reproduce the magnitude.** Its 18 web files
  run in 2.0s wall (import 5.3s aggregate, ~300ms/file) because the fixture
  Routes file only statically imports two small layouts. The user's 4–5s/file
  import is a property of _their_ Routes import graph. The benchmark in Phase 0
  needs a deliberately heavy Routes file.

### What the user's own route fix shows about the remaining cost

The user then built a workaround in their own `web/vite.config.ts` (appendix,
screenshot 6) that is Phase 1 of this plan done in userland: at config time it
calls `getProjectRoutes()` from `@cedarjs/internal`, renders a module that
`Object.assign`s `replaceParams` closures onto `MockRouter`'s `routes` object
and exports `UserRoutes = () => null`, and a `pre` transform hook substitutes
that module for `@cedarjs/testing/dist/web/globRoutesImporter.js`. With that in
place CI went from 506s to 318s wall and aggregate import from 1039s to 499s
(appendix, screenshot 5). That validates Phase 1's magnitude — and shows Phase 1
alone leaves the suite 39% slower than Jest was. The remaining budget for 211
files:

| Category          | Aggregate | Per file |
| ----------------- | --------- | -------- |
| import            | 499s      | ~2.4s    |
| setup             | 146s      | ~0.7s    |
| tests             | 126s      | ~0.6s    |
| jsdom environment | 97s       | ~0.46s   |

Two consequences for this plan:

- 2.4s of import per file after routes are gone is far too much to be "Vitest's
  isolated module execution overhead" in the abstract; it is the evaluation of
  some concrete set of modules in every file. Which modules — framework
  providers being inlined instead of externalized, or the app's own component
  graph (barrel imports pulling in the design system) — decides whether the fix
  is framework-side or guidance. Phase 0 profiles this rather than guessing, and
  Phase 4 acts on the result.
- ~0.7s of setup per file is the Cell-mock discovery + import + MSW start work
  in `vitest-web.setup.ts` plus the user's own setup file. Phase 2 stays
  justified. The user's attempt to "skip automatic Cell mocks" caused timeouts,
  which says their tests depend on auto-registered mocks — so any scoping of
  mock registration has to keep mocks for every Cell a test can render, which is
  exactly what the transform-injection variant in Phase 2's follow-up does and a
  blanket skip does not.

## Design principles applied

- **Enforcement lives at a choke point, not at call sites**
  ([design-principles.md](../design-principles.md)). The user's suggested
  workaround — a second Vitest project for "plain" component tests, and
  migrating simple tests off Cedar's `render` — pushes a framework cost onto
  every app's test suite organisation. The fix belongs in the framework's Vite
  plugins, where it applies to every test file at once and keeps the documented
  `render` / `routes.*()` / `standard()` contract unchanged.
- **A refusal is a fork, not a wall.** Phase 1 replaces route evaluation with
  static extraction and has a fallback for Routes files it cannot extract
  statically. The warning emitted in that case names the offending route and the
  two ways forward.

## Goals

- A web test file that renders a plain component pays for: jsdom, React Testing
  Library, the Cedar providers, and MSW. Not for the app's Routes import graph
  and not for a filesystem walk of `web/src`.
- `render`, `renderHook`, `MockProviders`, `routes.*()`, `mockGraphQLQuery`,
  `mockCurrentUser`, `mockRouteParams` and Cell `standard()` mocks keep working
  exactly as documented in `docs/docs/testing.md`. No test in the fixture
  project changes.
- Storybook is untouched.

## Non-goals

- Changing Vitest isolation or pool defaults for users. `closeServer()` already
  supports `isolate: false` for users who opt in; that remains their call.
- Reducing the cost of `@cedarjs/web` / Apollo / router provider modules
  themselves. Measure after Phases 1–2; revisit only if they dominate.
- Making `vitest-web.setup.ts` opt-in. Users rely on `mockGraphQLQuery` working
  without any per-file setup, and with Phases 1–2 the setup is cheap enough that
  an opt-out is not worth its documentation surface.
- Matching Jest's wall time. The per-file jsdom environment (~0.46s/file in the
  user's suite) and worker/isolation overhead are Vitest's, not Cedar's. The
  target of this plan is that framework-owned per-file cost approaches zero;
  whatever remains after that is a Vitest configuration question (`isolate`,
  `pool`, `environment`) the app owns.
- Supporting `pool: 'vmThreads'`. The user hit a missing `WritableStream` in MSW
  and ESM-in-CJS failures there; those are Vitest VM-context limitations shared
  by every MSW user, not something Cedar's setup can shim.

## Phase 0 — Reproducible benchmark

Before changing anything, build a fixture that reproduces the user's numbers so
each phase can be measured.

1. Copy `__fixtures__/test-project` to the scratchpad and link the framework
   with `yarn project:tarsync <copy>` (afterwards rerun `yarn install` at the
   repo root; tarsync leaves the root install stale).
2. Make its Routes import graph heavy in the way real apps are: add a
   `web/src/layouts/HeavyLayout` that statically imports a handful of large
   dependencies already in the fixture's `node_modules` (e.g. the full
   `@apollo/client`, `graphql`, `react-hook-form`, a few dozen generated
   components), and use it in a `<Set wrap={HeavyLayout}>`. Add ~20 Cells with
   mocks so Cell discovery has something to find.
3. Add three probe tests: a plain component (`render(<Button/>)`), a component
   that calls `routes.home()`, and a Cell test that uses `standard()`.
4. Record, per file and for the whole suite: Vitest's `import` / `setup` /
   `tests` split, wall time, and peak RSS (`/usr/bin/time -l` on macOS). Run
   each measurement three times. Keep the fixture and the numbers in the PR
   description.

5. Profile what the plain-component probe's `import` time consists of, both
   before and after Phase 1. Two views are needed:
   - Which modules are inlined (transformed by Vite and re-evaluated in every
     isolated file) versus externalized (loaded through Node and cached per
     worker). `DEBUG=vite-node:*` / Vitest's `server.debug.dumpModules` lists
     them. `@cedarjs/testing` is inlined on purpose (`ssr.noExternal`); check
     that `@cedarjs/web`, `@apollo/client`, `@cedarjs/router` and
     `@cedarjs/auth` are externalized and not dragged into the inlined set
     through the `MockRouter` / `mockAuth` re-exports or the test-mode import
     transforms.
   - A CPU profile of one worker
     (`poolOptions.threads.execArgv: ['--cpu-prof']`, or `--cpu-prof` on the
     Vitest process with `pool: 'forks'` and a single fork) to see which module
     bodies dominate evaluation.

   Separate the result into framework-owned modules and app-owned modules (the
   component under test's own import graph, e.g. a design-system barrel). Phase
   4 acts on the framework-owned part; app-owned cost becomes guidance in
   Phase 5.

## Phase 1 — Static route map instead of evaluating `Routes.tsx`

Populate `MockRouter`'s `routes` table from a statically extracted
`{ name: path }` map, produced once by a Vite plugin in the main process, so no
test file evaluates the Routes module or its imports.

### Plugin: `cedarTestRouteMapPlugin`

New file `packages/vite/src/plugins/vite-plugin-cedar-test-route-map.ts` (lives
in `@cedarjs/vite` because that package already depends on `@cedarjs/internal`
and `@cedarjs/structure` and already consumes `getProjectRoutes()` in
`buildRouteManifest.ts` and `devFeServer.ts`; `@cedarjs/testing` must not depend
on `@cedarjs/vite` — the dependency already runs the other way). Wired in
`packages/vite/src/index.ts` next to the other `mode === 'test'` plugins.

- `resolveId('virtual:cedar-test-route-map')` →
  `\0virtual:cedar-test-route-map`.
- `load()` reads `getPaths().web.routes`, parses it with `@babel/parser`
  (`typescript`, `jsx` plugins — the vite package already has the Babel
  dependencies for `vite-plugin-cedar-routes-auto-loader.ts`), and walks every
  `JSXElement` named `Route` regardless of nesting (`Set`, `PrivateSet`,
  `Private`, fragments, arrays). For each one it classifies the `name` and
  `path` attributes: a `StringLiteral`, a `JSXExpressionContainer` holding a
  `StringLiteral`, or an expression-free `TemplateLiteral` is a literal;
  anything else (an identifier, a call, a spread attribute on the element) is
  computed. Routes with literal `name` and `path` go into the map. Routes with
  no `name` (`notfound`, unnamed redirects) are skipped, matching
  `MockRouter.Router`'s `if (name && path)`. Element identity is checked
  through Babel's scope bindings: a `Route` element only counts if its name
  resolves to an import specifier from `@cedarjs/router` (the source string
  before `cedarJsRouterImportTransformPlugin` rewrites it); a local component
  or a differently sourced `Route` is not a Cedar route. A single computed
  `name` or `path` anywhere in the file, a `Route` whose binding is not the
  `@cedarjs/router` import, a route name that appears more than once, or a
  parse error, selects the fallback below — the decision is made on the AST,
  before anything is generated.
- What the scan deliberately does not model is conditional inclusion:
  `{flag && <Route .../>}` or a route inside a branch that does not render
  contributes to the map regardless. That is the same semantic
  `web-routerRoutes.d.ts` generation has (it is also built from every `Route`
  element in the file), so tests see exactly the `routes.*()` set the type
  system already promises. The only way the superset can mislead is a name
  reused across branches with different paths, which is why duplicate names
  select the fallback.
- `getProjectRoutes()` from `@cedarjs/internal` is _not_ used at runtime even
  though `@cedarjs/vite` already depends on it. `RWRoute.path` and
  `RWRoute.name` return `undefined` for a non-literal attribute, and
  `getProjectRoutes()` passes every non-notfound route's `path` straight into
  `getRouteRegexAndParams()`, which throws on `undefined.matchAll` — so a
  computed `path` would crash Vitest startup before any fallback could run, and
  a computed `name` would be dropped silently. The same model does generate
  `web-routerRoutes.d.ts`, so the plugin's unit tests use `getProjectRoutes()`
  as the oracle on the fixture Routes file to assert the Babel walk yields the
  same named set. The user's workaround calls `getProjectRoutes()` from
  `vite.config.ts` and works because their Routes file has only literal
  attributes.
- Emits:

  ```js
  export const routeMap = { home: '/', blogPost: '/blog-post/{id:Int}', ... }
  export const UserRoutes = null
  ```

- Calls `this.addWatchFile(routesPath)` so the virtual module is invalidated
  when the Routes file changes in watch mode, and handles `watchChange` for the
  Routes path by invalidating the virtual module id in the module graph.

### Fallback when extraction is not possible

If the AST walk finds a `Route` with a computed `name` or `path` (a variable,
a call, a spread attribute), a `Route` element whose binding is not the
`@cedarjs/router` import, a route name used more than once, or the Routes
file fails to parse, the plugin emits the current behaviour instead:

```js
export const routeMap = null
export { default as UserRoutes } from '<absolute routes path>'
```

and logs once per run:

> `@cedarjs/testing` could not build the test route map statically from
> `web/src/Routes.tsx`: the `<Route>` at line N has a computed `path`. Tests
> will evaluate the Routes file and its imports in every test file, which is
> slow. Use string literals for `name` and `path` on every `<Route>` to enable
> the fast path, or keep the computed value if the Routes file needs it.

Note the parity limit: `MockRouter.Router` only flattens the React children
tree, so `<Route>`s rendered from inside a custom component are already
invisible to `routes.*()` today. The static walker sees every `Route` JSX
element in the file, which is a superset (see the conditional-inclusion note
above). Routes composed from a _separate_ file (`<AdminRoutes/>`) are not
covered by either path.

### Consumers in `@cedarjs/testing`

- `MockRouter.tsx`: add
  `export function registerRoutes(map: Record<string, string>)` that
  _replaces_ the generated entries: it deletes every key it registered on a
  previous call (tracked in a module-level `Set`), then sets
  `routes[name] = (args = {}) => replaceParams(path, args)` — the same closure
  `Router` builds — for each entry in the new map. Replace rather than fill so
  a route removed or renamed in watch mode (or, under Phase 4, on a worker that
  keeps the module across files) cannot leave a stale builder behind. `Router`
  itself stays as-is for users who render a `<Router>` explicitly in a test;
  entries it adds are not tracked and not cleared. The watch-mode check in
  Verification covers removal and rename, not just addition.
- `vitest-web.setup.ts`:
  `import { routeMap, UserRoutes } from 'virtual:cedar-test-route-map'` and
  `import { registerRoutes } from '../MockRouter.js'`; call
  `registerRoutes(routeMap ?? {})` unconditionally at module top level. Passing
  an empty map when `routeMap` is null is what clears the tracked entries on
  the transition from a static map to the fallback (a watched edit that
  introduces a computed attribute), so no stale builder survives it; the
  fallback's rendered `<UserRoutes />` then repopulates `routes` through
  `MockRouter.Router` as before.
  Setup files run before the test file is imported, and the setup file's
  `MockRouter` module instance is the same one the test file's transformed
  `@cedarjs/router` import resolves to, so `routes.*()` is populated before any
  test body runs. Export `UserRoutes` from the setup module's scope is not
  possible, so store it: `setTestUserRoutes(UserRoutes)` on a tiny module-level
  holder in `MockProviders.tsx` (or a new `testRoutes.ts`).
- `MockProviders.tsx`: render `<UserRoutes />` only when the holder is non-null
  (the fallback case). Delete the `require('~__CEDAR__USER_ROUTES_FOR_MOCK')`
  block and `isModuleNotFoundError`.
- Delete `globRoutesImporter.ts`. Delete the test-mode
  `~__CEDAR__USER_ROUTES_FOR_MOCK` alias in `getMergedConfig.ts` and the
  `knip.jsonc` ignore entry. Keep `ssr.noExternal: ['@cedarjs/testing']` for now
  — the setup file has to be processed by Vite to resolve the virtual module;
  Phase 4 decides whether that inlining can be narrowed to the setup file alone.
- Ambient types: `declare module 'virtual:cedar-test-route-map'` in
  `packages/testing/src/web/vitest/ambient.d.ts`.
- `packages/testing`'s own unit tests import `MockRouter` directly and never
  load the setup file, so they need no stub.

### Why not a lighter alternative

- _Separate lightweight and router-aware renderers_ (the user's suggestion):
  changes the documented API, forces every app to classify its tests, and leaves
  the default slow. Rejected.
- _Lazy `routes` Proxy that imports Routes on first access_: `routes.home()` is
  synchronous; ESM has no synchronous import. Rejected.
- _A userland transform, as in the user's workaround_: works, but every app
  would have to copy it, it keys on a dist file path inside `@cedarjs/testing`,
  and it depends on `@cedarjs/internal`'s route model from user config. The
  framework owning it is the point.

## Phase 2 — Cell mock discovery without a per-file filesystem walk

Replace `findCellMocks` + `fast-glob` in `vitest-web.setup.ts` with Vite's
`import.meta.glob`, which is expanded in the main process at transform time,
cached, and invalidated by Vite's watcher:

```ts
const cellMocks = import.meta.glob('/src/**/*Cell/*.mock.{js,ts,jsx,tsx}')

beforeAll(async () => {
  for (const load of Object.values(cellMocks)) {
    await load()
  }
  await startMSW('node')
  setupRequestHandlers()
})
```

(`/src/…` is root-relative, and Vite's root is `web/` via `getMergedConfig.ts`;
`globRoutesImporter.ts` used the same convention. Verify in Phase 0 that running
`vitest` from the project root, where Vitest projects are configured by
`vitest.config.ts`, still resolves the root to `web/`.)

The per-file cost that remains is importing each mock module, and each of those
is a Vite transform-cache hit after the first worker sees it. Measure this. If
the import loop still shows up, run the follow-up experiment below; otherwise
stop here.

`findCellMocks.ts` and its test stay: `packages/testing/src/web/index.ts`
deliberately does not export it, but it is still the API-neutral helper other
tooling can use.

### Follow-up experiment: scope mock registration to imported Cells

Instead of registering every mock in the app, have `cedarCellTransform`
(`packages/vite/src/plugins/vite-plugin-cedar-cell.ts`) prepend
`import './<CellName>.mock'` to a Cell module in test mode when a sibling mock
file exists. A Cell's mock is then registered exactly when the Cell is in the
test's import graph — which is exactly when a test can render it. This makes
setup cost independent of app size. It is a behavioural change (a test that
issues a raw `useQuery` for a Cell's operation without importing the Cell would
lose the mock), so treat it as a separate, measured PR with its own changeset,
and only if Phase 2's numbers justify it. Watch for the import cycle
(`Cell → mock → Cell` via the `afterQuery` import the mock-cell-data plugin
adds); both sides only use the other's bindings lazily, so it should be safe,
but it needs a fixture test.

## Phase 3 — MSW start cost (measure only)

`startMSW('node')` does an opaque `await import('msw/node')` and
`setupServer().listen()` per file. It has to stay per file (each isolated file
has fresh globals to patch). Measure its share in Phase 0; the likely outcome is
that it is a small constant and nothing changes. If it is not, the cheap option
is a static `import { setupServer } from 'msw/node'` at the top of
`vitest-web.setup.ts` (that file is Node-only, unlike `mockRequests.ts`, which
Storybook also bundles) passed into `startMSW`.

## Phase 4 — Remaining framework-owned import cost

The user's numbers after their own route fix leave ~2.4s of import per file, so
this phase is not conditional; what it does depends on the Phase 0 profile.

- If framework modules are being inlined and re-evaluated per file when they
  could be externalized: fix the inline/external split. Candidates are the
  `@cedarjs/router/dist/*` and `@cedarjs/auth` re-exports reached through
  `MockRouter.tsx` and `mockAuth.tsx`, and anything the test-mode import
  transforms (`cedarJsRouterImportTransformPlugin`,
  `createAuthImportTransformPlugin`, `autoImportsPlugin`) redirect into the
  inlined `@cedarjs/testing` graph. Vitest's `server.deps.inline` /
  `deps.optimizer` and the `ssr.noExternal` entry in `getMergedConfig.ts` are
  the knobs.
- The specific candidate the user's investigation names (appendix, screenshot 8,
  item 4): stop inlining `@cedarjs/testing` as a whole. The only reason it is
  inlined is `import.meta.glob` in package code. After Phase 1 the route glob is
  gone, and Phase 2's Cell-mock glob lives in `vitest-web.setup.ts`, so the
  inline set can shrink to that one file (a regex entry in
  `server.deps.inline`); `MockRouter`, `mockRequests`, `mockAuth`,
  `MockProviders` and `customRender` would then be loaded by Node once per
  worker instead of re-evaluated per file. Two things have to hold before doing
  this:
  - The setup file's relative imports (`../MockRouter.js`, `../mockRequests.js`)
    must resolve to the _same_ externalized module instances the test file
    reaches through the transformed `@cedarjs/router` and `@cedarjs/testing/web`
    imports. Otherwise `routes` and the MSW handler queue split into two copies.
    Verify with a probe that mutates `routes` in the setup file and reads it in
    a test.
  - Module-level state in those files stops being per file:
    `mockedUserMeta.currentUser`, `mockedRouteParamsMeta.params`,
    `REQUEST_HANDLER_QUEUE`, `SERVER_INSTANCE`. `closeServer()` already handles
    `SERVER_INSTANCE`; the rest needs an explicit `resetTestState()` so a
    `mockCurrentUser()` in one file cannot leak into the next file on the same
    worker. The reset has to run at the setup file's module top level, not in
    its `beforeAll`: Vitest evaluates setup files before it imports the test
    file, and `beforeAll` runs after the test file's module scope has already
    executed — so a `mockCurrentUser()` or `mockGraphQLQuery()` call at the top
    of a test file lands between the two, and a `beforeAll` reset would erase
    the current file's own state. The setup file is re-executed for every test
    file even when the rest of `@cedarjs/testing` is externalized, which is
    what makes its top level the right per-file boundary. `REQUEST_HANDLER_QUEUE`
    is the subtle one: Cell mocks are pushed to it once per worker (their
    modules are cached), so those must be kept, while handlers a test file
    registers at module scope before the server starts must not survive the
    file. Keep two queues — `GLOBAL_HANDLERS` for Cell mocks (registered
    through the setup file's own imports) and `FILE_HANDLERS` for everything
    else — and clear only `FILE_HANDLERS` in the top-level reset. A length
    snapshot taken in `beforeAll` does not work for the same ordering reason:
    it would already include the current file's entries.

  If the Phase 0 profile shows `@cedarjs/testing`'s own evaluation is a small
  share, skip this: the state-scoping change is not worth it for a small win.

- If the cost is the evaluation of the providers themselves (`CedarProvider`,
  `CedarApolloProvider`, `LocationProvider`), they are needed by `render` and
  are shared through Vite's transform cache, so only their evaluation repeats.
  Moving the `MockProviders` import in `customRender.tsx` behind a `React.lazy`
  boundary would defer it to the first `render` call — which every test that
  imports `render` makes, so this only helps files that import
  `@cedarjs/testing/web` for `screen` / `waitFor` alone. Do it only if the
  profile shows the providers dominate.
- If the profile shows the cost is app-owned (the component's own import graph),
  there is nothing to change in the framework; write it up as guidance in
  Phase 5.

## Phase 5 — Docs and release notes

- `docs/docs/testing.md`, "Testing Components" info box: keep the description of
  what `render` wraps; add one sentence that `routes.*()` is populated from the
  project's Routes file without evaluating it, and that computed `name` / `path`
  props on `<Route>` fall back to evaluating the file (with the warning text).
- `docs/docs/testing.md`, same info box: document the existing escape hatch for
  tests that want no Cedar providers at all — import `render` from
  `@testing-library/react` directly, or pass React Testing Library's `wrapper`
  option to compose only the providers the test needs. State why there is no
  Cedar-specific "plain" `render` variant or `render` option for this: the
  providers are set up when the module is imported, not when `render` is called,
  so a variant would only skip work if it lived in a separate entry point, and
  the per-file cost that made the question come up is removed by the static
  route map instead. An entry point users have to choose between would put a
  test-classification burden on every app and leave the default slow for anyone
  who does not opt in.
- `docs/docs/testing.md`, new short subsection "Test suite performance": what a
  web test file pays for under Cedar's default setup (jsdom, providers, MSW,
  Cell mocks) and what it does not (the Routes import graph); that
  `isolate: false` is supported by Cedar's setup (`closeServer()` restarts MSW
  per file and keeps the queued global handlers) for suites that accept shared
  module state; and, if the Phase 0 profile shows app-owned import cost, a note
  on keeping test import graphs small (import the component file, not a barrel).
- Changeset for the `@cedarjs/testing` / `@cedarjs/vite` PR describing the
  per-file cost that is removed and the fallback warning. Phrase it in terms of
  what the current behaviour is. Include a note for apps that carry a userland
  transform targeting `@cedarjs/testing/dist/web/globRoutesImporter.js` (the
  user's workaround in appendix screenshot 6): that file does not exist after
  this change, so the transform never matches and can be deleted along with its
  config-time `getProjectRoutes()` call.
- Update the `cedarVitestWebConfigPlugin` doc comment to list what the setup
  file does.

## Verification

- Phase 0 benchmark before and after each phase, on the heavy fixture: per-file
  `import` / `setup`, suite wall time, peak RSS. Target for the plain-component
  probe is import time in the same range as the user's "Testing Library
  directly" number (~1s) or better, and setup time independent of the number of
  Cells in the app.
- `yarn workspace @cedarjs/testing test`, `yarn workspace @cedarjs/vite test`,
  including new unit tests for the route-map plugin: nested `Set` /
  `PrivateSet`, `notfound`, redirect without name, template-literal path,
  computed path (fallback), and a Routes file that also statically imports a
  layout (assert the layout module is never loaded: give it a top-level
  `throw`).
- Fixture project (`__fixtures__/test-project`) web suite through tarsync: all
  18 files pass unchanged, including `HomePage.test.tsx` and the Cell tests that
  depend on `standard()` and on MSW intercepting the Cell's query.
- Watch mode: edit Routes.tsx four ways without restarting Vitest — add a
  route and confirm a test using the new `routes.*()` entry reruns and passes;
  remove a route and confirm `routes.<removed>` is `undefined` in the rerun;
  rename a route and confirm only the new name resolves; change one `path` to
  a variable and confirm the fallback warning is logged once, the tracked
  static entries are cleared, and `routes.*()` still resolves through the
  rendered Routes file.
- Storybook smoke: `yarn cedar storybook` in the fixture still resolves
  `~__CEDAR__USER_ROUTES_FOR_MOCK` through its own alias.
- `yarn build && yarn lint && yarn test:types`.

## Sequencing

1. **PR 1 — Phase 0 + Phase 1.** Self-contained, biggest win, removes dead code
   (`require` branch, test-mode alias, `globRoutesImporter.ts`). `fix(testing)`.
2. **PR 2 — Phase 2** (`import.meta.glob` discovery), with Phase 3 numbers in
   the description. `fix(testing)`.
3. **PR 3 (optional) — scoped mock registration**, only if PR 2's measurements
   call for it. `feat(testing)!` if it changes observable behaviour.
4. Phase 4 and 5 fold into whichever PR their trigger lands in; Phase 5's doc
   edits go in PR 1.

Report the before/after numbers back to the user who filed this, with a note
that their Routes import graph is what sets the magnitude.

## Open questions

- Does `import.meta.glob('/src/**')` in a setup file that lives in
  `node_modules/@cedarjs/testing/dist` resolve against the `web/` root when
  Vitest is started from the project root with the `projects` config? Both the
  existing `globRoutesImporter.ts` and this plan assume yes; Phase 0 confirms.
- Should the fallback warning be an error in CI (`process.env.CI`)? Leaning no:
  a slow suite is better than a red one over a style constraint on `Routes.tsx`.
- The user reported `vmThreads` failing on a missing `WritableStream` in MSW.
  That is a separate Vitest/MSW environment issue, out of scope here; note it in
  the reply to the user.

## Appendix: the user's investigation, verbatim

The four screenshots the user posted, transcribed. These are the output of the
user's own AI-assisted investigation of their app; the corrections above apply.

### Screenshot 1 — The import cost is caused by Cedar's test wrapper

The import cost is caused by Cedar's test wrapper, not primarily by application
imports.

Every test using:

```ts
import { render } from '@cedarjs/testing/web'
```

loads `MockProviders`, which imports:

- the complete `Routes.tsx` graph;
- Cedar/Apollo/auth/router providers;
- every Cell mock;
- MSW setup.

That happens for almost every isolated test file. With 211 files, CI accumulated
**1039 seconds** of module evaluation.

Only moving the six existing `.test.ts` files to a lightweight project would
barely affect the total. We need to migrate simple component tests away from
Cedar's full wrapper.

### Screenshot 2 — Potential explanation for the platform author

Vitest is slower because Cedar's web testing integration performs substantial
global setup in every isolated test file, regardless of whether that file uses
Cedar's test renderer or GraphQL mocking.

`cedarVitestWebConfigPlugin()` injects `vitest-web.setup.js` into all web tests.
For each isolated file, that setup:

1. Scans the entire web source tree for Cell mocks.
2. Dynamically imports every discovered Cell mock.
3. Starts and configures an MSW server.
4. Re-registers request handlers after each test.
5. Closes the server after the file completes.

Tests importing `@cedarjs/testing/web` incur another cost: Cedar's custom
`render` eagerly imports `MockProviders`, which resolves `Routes.tsx`. Vite then
transforms the routes and associated application graph for each isolated test
environment, even when the test only renders a primitive component.

#### Measured examples

**One Button test using Cedar render:**

- `4.21s` import
- `477ms` setup
- `5.54s` total

**Equivalent test using Testing Library directly:**

- `0.90s` import
- `479ms` reported setup
- `5.57s` total

The unchanged wall time shows that removing `MockProviders` alone does not
remove the global Cell/MSW work. It largely shifts work between Vitest's timing
categories.

#### Across the CI suite

- Jest: 210 files in `228.38s`
- Vitest: 211 files in `505.78s`
- Vitest aggregate import time: `1039.27s`
- Vitest setup time: `151.57s`
- Actual test execution: `114.42s`

A local run with more workers reduced wall time but used about `6.6 GB` RSS and
became unstable. Four workers used about `2 GB` but took roughly `425s`. The
current workload therefore scales poorly through additional workers.

#### Jest performed conceptually similar setup, but its implementation path was cheaper

- Jest used Cedar's CommonJS testing build and Jest's transformed-module cache.
- Cedar's CommonJS `globRoutesImporter` contains a stubbed `import.meta.glob`.
- `Routes.tsx` was resolved through Jest's dedicated module mapper.
- Vitest executes Cedar's real eager Vite glob and Vite transformation pipeline.
- Vitest repeats this Vite/ESM evaluation in each isolated environment.
- The resulting memory pressure limits how effectively worker concurrency can
  amortize the repeated work.

### Screenshot 3 — Coverage, pool changes, and platform-level opportunities

Coverage is unlikely to explain the regression. The previous Jest configuration
instrumented a broader source set, including unexecuted stories and an API
module, while Vitest reports only loaded web modules.

#### Pool changes did not resolve it

- `forks` was slower than `threads` in a controlled sample.
- `vmThreads` failed because MSW encountered a missing `WritableStream`.
- Disabling isolation would avoid repeated work, but is not acceptable for this
  suite.

#### Likely platform-level opportunities

- Do not inject Cell discovery, Cell imports, and MSW setup into tests that do
  not use Cedar GraphQL facilities.
- Split Cedar's test setup into lightweight DOM setup and opt-in GraphQL/Cell
  setup.
- Avoid loading `Routes.tsx` from the default `render`; provide a lightweight
  renderer and a separate router-aware renderer.
- Avoid including both the virtual `Routes.tsx` alias and the real eager
  `import.meta.glob` route importer in `MockProviders`.
- Cache Cell discovery outside isolated workers if imports still need to remain
  per environment.
- Consider registering only Cell mocks reachable from the test rather than every
  Cell mock in the application.

The strongest immediate workaround at the application level is a separate
isolated Vitest project for plain component tests. It can retain jsdom and
application setup while omitting Cedar's unconditional Cell/MSW setup.
[Routes/GraphQL]-dependent tests would continue using the existing project.

### Screenshot 4 — Empty-routes experiment confirms Routes.tsx as an independent cause

Yes. I tested the same Cedar-render Button test with both route entry points
replaced by an empty component, while keeping Cedar's Cell discovery and MSW
setup enabled.

| Configuration         | Vitest duration | Import | Setup | Wall time | Peak RSS |
| --------------------- | --------------- | ------ | ----- | --------- | -------- |
| Normal `Routes.tsx`   | 6.33s           | 4.85s  | 615ms | 7.70s     | 691MB    |
| Empty routes          | 2.38s           | 0.98s  | 565ms | 3.63s     | 567MB    |
| Empty routes, repeat  | 2.25s           | 0.97s  | 480ms | 3.55s     | 558MB    |
| Normal routes, repeat | 5.65s           | 4.48s  | 475ms | 6.91s     | 696MB    |

Removing `Routes.tsx` reduced:

- Vitest duration by roughly 58 to 60%.
- Import time by roughly 78%.
- Wall time by roughly 48%.
- Peak memory by roughly 130MB for one test worker.

This confirms that loading `Routes.tsx` is a major independent cause, not just a
reporting artifact caused by Cell setup. Cedar's setup remained active and its
timing was similar in both configurations.

The likely platform defect is in `MockProviders`: under Vitest it loads routes
through both:

- `~__CEDAR__USER_ROUTES_FOR_MOCK`
- `globRoutesImporter.js`, using an eager `import.meta.glob`

The CommonJS/Jest build stubs the latter, while Vitest executes the real eager
Vite path. At minimum, Cedar should avoid loading both route entry points under
Vitest. Better options would be making routes optional in the default renderer
or exposing separate lightweight and router-aware renderers.

All temporary benchmark files were removed. The worktree is clean.

### Screenshot 5 — After the user's local route fix

> it's still slower then jest

Correct. The optimized Vitest suite remains slower than Jest on the same CI
host:

- Jest: `228.38s`
- Vitest before route fix: `505.78s`
- Vitest after route fix: `318.45s`
- Remaining gap: about `90s`, or 39%

The route fix cut aggregate import time from `1039s` to `499s`, but further
probes did not yield a safe improvement:

- Skipping automatic Cell mocks: slower under coverage and caused timeouts.
- `forks`: slower than `threads`.
- Filesystem module cache: negligible benefit on a warm run.
- Native imports: incompatible with Cedar's `src/*` aliases.
- `vmThreads`: requires compatibility shims and then fails on ESM-in-CommonJS
  dependencies.

Current CI time is approximately:

- Imports: `499s` aggregate
- Setup: `146s`
- Tests: `126s`
- jsdom environments: `97s`
- Wall time: `318s`

At this point, the residual difference appears to be Vitest/Vite's isolated
module execution overhead across 211 files, rather than another single
application graph accidentally loaded everywhere. Closing the remaining gap
likely requires a platform change in Cedar/Vitest, test-file consolidation, or
splitting lightweight tests into a separate configuration without Cedar's setup.
The worktree remains clean; no unsuccessful experiment was retained.

### Screenshot 6 — The user's workaround (`web/vite.config.ts` diff)

The user described this as "a partial fix". The diff, transcribed:

```ts
import { getProjectRoutes } from '@cedarjs/internal/dist/routes.js'
import { cedar } from '@cedarjs/vite'

const webRoot = path.dirname(fileURLToPath(import.meta.url))

const namedRoutes = getProjectRoutes().filter(
  (route) => !route.isNotFound && route.name
)

// MockRouter only needs named route builders; loading Routes.tsx also imports
// the application graph in every isolated test file.
const routeRegistryModule = `
import { routes } from '@cedarjs/testing/web/MockRouter.js'
import { replaceParams } from '@cedarjs/router/dist/util'

Object.assign(routes, {
${namedRoutes
  .map(
    ({ name, pathDefinition }) =>
      `  ${JSON.stringify(name)}: (args = {}) => replaceParams(${JSON.stringify(pathDefinition)}, args),`
  )
  .join('\n')}
})

export const UserRoutes = () => null
`

export default defineConfig(({ mode }) => ({
  plugins: [
    mode === 'test' && {
      name: 'cedar-test-route-registry',
      enforce: 'pre',
      transform(_code, id) {
        if (id.endsWith('/@cedarjs/testing/dist/web/globRoutesImporter.js')) {
          return routeRegistryModule
        }
      },
    },
    cedar({ mode }),
  ],
  resolve:
    mode === 'test'
      ? {
```

### Screenshot 7 — "what did change to the jest implementation?"

> what did change to the jest implementation?

Nothing changed in Jest itself. The migration stopped using Jest and switched
Cedar's web tests to its newer Vitest integration.

The relevant implementation difference already existed inside
`@cedarjs/testing`:

**Jest path**

- Uses `@cedarjs/testing/config/jest/web/jest-preset.js`.
- Maps `~__CEDAR__USER_ROUTES_FOR_MOCK` directly to `Routes.tsx`.
- Uses the CommonJS build of `MockProviders`.
- The CommonJS `globRoutesImporter.js` deliberately stubs `import.meta.glob`:

  ```js
  const import_meta = { glob: () => ({ 'routes.tsx': () => null }) }
  ```

- Therefore, `MockProviders` does not load `Routes.tsx` through that second
  route-import mechanism.
- Jest only resolves it through the dedicated module mapper.
- Jest applies Babel transforms and maintains its own transformed-module cache
  per worker.

**Vitest path**

- Cedar's Vite plugin injects its Vitest configuration and setup.
- `MockProviders` imports the ESM `globRoutesImporter.js`.
- That module runs a real eager Vite glob:

  ```js
  import.meta.glob(['/src/Routes.{tsx,jsx}', '/Routes.{tsx,jsx}'], {
    import: 'default',
    eager: true,
  })
  ```

- This loads and transforms `Routes.tsx` and its static application graph in
  every isolated test file.
- Cedar also defines `~__CEDAR__USER_ROUTES_FOR_MOCK`, although that
  CommonJS-style `require()` path does not appear to provide the route helpers
  under Vitest.
- The real route helpers were effectively coming from the eager glob.

Our route-registry workaround makes the Vitest behavior closer to the Jest
implementation:

- It prevents the Vitest-only eager application graph from loading.
- It generates only the named `routes.*()` helpers needed by tests.
- It avoids importing layouts and pages merely to register route names.

So the regression was not caused by modifying Jest. It came from switching from
Cedar's established Jest/CJS testing path to Cedar's Vitest/Vite/ESM path, whose
route handling and isolated module execution are more expensive. After fixing
the route discrepancy, Vitest still has about 39% more wall-clock overhead than
Jest on the same CI host.

### Screenshot 8 — Residual cost and platform recommendations

The residual cost is spread across every isolated file:

- Imports: `499.36s` aggregate
- Setup: `145.68s`
- Tests: `126.49s`
- jsdom environments: `97.29s`
- Wall time: `318.45s`

This now points to Cedar/Vitest platform work:

1. Cedar should provide a lightweight test renderer that does not import route
   machinery.
2. Cedar's Vitest setup should make Cell discovery and MSW opt-in.
3. Vitest/Cedar should support a VM pool without the current globals and ESM/CJS
   failures.
4. The testing package should be dependency-optimizer compatible rather than
   containing a runtime `import.meta.glob`.
5. Cedar should benchmark its Jest and Vitest presets with isolated jsdom files
   before making Vitest the expected faster path.

The route fix already addresses the largest Cedar-specific defect we could
safely work around. The remaining 39% needs an upstream fix or a Vitest version
with materially lower isolated module-runner overhead. No failed probes remain
in the worktree.
