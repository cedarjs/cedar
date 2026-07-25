# CEDARJS — PROJECT OVERVIEW

> Default mode: SPA (single page application). SSR/RSC are experimental features
> with separate docs. `*SSR/RSC` is used to mark where behavior changes with
> those features enabled.
>
> **[SSR-RSC-DOC]** = `docs/implementation-docs/2026-03-26-cedarjs-project-overview-ssr-rsc.md`

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────┐
│ USER PROJECT: api/src/ │ web/src/ │ cedar.toml │ Routes.tsx │ Cells │
└──────────────┬──────────────────────────────┬───────────────────────┘
               │                              │
┌──────────────▼──────────────────────────────▼────────────────────────┐
│ CORE: cli│router│auth│web│api│graphql-server│vite│forms│prerender    │
│        realtime│jobs│mailer│storage│record│codemods                  │
├──────────────────────────────────────────────────────────────────────┤
│ INFRA: project-config│internal│structure│testing│storybook│context   │
│        server-store│gqlorm│babel-config│eslint│tui│telemetry│utils   │
├──────────────────────────────────────────────────────────────────────┤
│ ADAPTERS: fastify-web                                                │
│ AUTH: dbAuth│Auth0│Clerk│Firebase│Supabase│Netlify│AzureAD│ST│Custom │
├──────────────────────────────────────────────────────────────────────┤
│ RUNTIME: Node.js │ Vite │ Fastify │ Apollo Client │ Prisma │ React   │
│ version:   24    │  7   │    5    │       4       │   7    │ 18/19   │
└──────────────────────────────────────────────────────────────────────┘
```

## REQUEST LIFECYCLE

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ SPA MODE (default)                                                            │
│                                                                               │
│  WEB (Fastify)                              API (Fastify + AsyncLocalStorage) │
│  ────────────────                           ───────────────────────────────── │
│  Browser ──GET──▶ static files/prerender           │                         │
│                    │                                ▼                        │
│               SPA fallback                      GraphQL Yoga                  │
│               (200.html if present,           (services use @cedarjs/context)  │
│                else index.html)                                               │
│                    │                                                          │
│                    ▼                                                         │
│               React (client)                                                  │
│               → Apollo fetches data                                          │
│               → Router renders page                                          │
└───────────────────────────────────────────────────────────────────────────────┘

*SSR/RSC: see [SSR-RSC-DOC] (Web: Express + AsyncLocalStorage; middleware; streaming)
```

## AUTH FLOW

```
┌──────────────────────────────────────────────────────────────┐
│ AuthProvider (client only in SPA)                            │
│                                                              │
│  AuthProvider mounts → serverAuthState is null              │
│    useEffect:                                                │
│      1. authImplementation.restoreAuthState() (SDK init)     │
│      2. reauthenticate()                                     │
│         → getToken() from provider SDK                      │
│         → getCurrentUser() via GraphQL API call             │
│         → set {loading, isAuthenticated, userMetadata, ...} │
│                                                              │
│  Auth endpoints (login/signup/logout) handled by provider    │
│  SDK directly (e.g. Auth0 redirect, Firebase popup,          │
│  dbAuth calls to API server functions)                       │
│                                                              │
│  <PrivateSet> → checks isAuthenticated, redirects if false  │
└──────────────────────────────────────────────────────────────┘

DECODER INTERFACE (all providers implement this):
  (token: string, type: string, req: {event}) → Promise<decoded | null>

PROVIDERS: dbAuth(cookie), Auth0/Clerk/SuperTokens(JWKS), Firebase(admin SDK),
           Supabase(cookie+JWT), Netlify(Lambda context), AzureAD(JWKS)

*SSR/RSC: middleware decodes auth server-side, injects state via <script> tag.
   Auth immediately available, no loading. See [SSR-RSC-DOC]
```

## DATA LOADING

```
CLIENT CELL (GraphQL via Apollo):
┌─────────────────────┐
│ *Cell.tsx           │
│ export QUERY        │     ┌─────────────────────┐
│ export Loading      │     │ GraphQL Yoga        │
│ export Success      │     │ SDLs (schema) +     │ gqlorm: Prisma API → Proxy →
│ export Failure      │───▶│ Services (resolvers)│   QueryBuilder → GraphQL →
│ export Empty        │     │ +directives         │    useQuery → Apollo Client
│ export beforeQuery  │     │ +subscriptions      │
│                     │     │ +Armor              │
│ vite plugin         │     │  → Prisma → DB    │
│  → createCell()    │     └─────────────────────┘
│    builds default   │
│    exported HOC     │
│  → useQuery(QUERY) │
│  → Apollo Client   │
└─────────────────────┘

*SSR/RSC: Server Cells export `data` function (async), render directly,
   no GraphQL/Apollo. See [SSR-RSC-DOC]
```

## DEV / BUILD

```
cedar dev:
  Default (no flags):
    concurrently ─┬─ api: cedar-api-server-watch (CJS) or cedarjs-api-server-watch (ESM)
                  │      (chokidar + esbuild, kept for SSR/RSC)
                  ├─ web: cedar-vite-dev (SPA) or cedar-dev-fe (Streaming SSR)
                  └─ cedar-gen-watch (regenerate types on SDL or Prisma schema
                     change)

  With --ud (opt-in unified dev):
    concurrently ─┬─ cedar-unified-dev (single Vite dev server on one port)
                  │    ├─ API requests handled inline via `configureServer`
                  │    │    middleware (Vite SSR + fetch-native dispatch,
                  │    │    no separate Fastify listener)
                  │    └─ Web assets served by Vite client dev server (SPA, HMR)
                  └─ cedar-gen-watch

*SSR/RSC: cedar-vite-dev adds Express + Vite SSR servers. See [SSR-RSC-DOC].

cedar build:
  prisma gen → GraphQL types → validate SDLs →
  default: legacy separate builds
    API (`buildApi()` esbuild → api/dist/, string transforms; Babel pass only
      when api/babel.config.js exists) →
    Web (`cedar-vite-build` → web/dist/) →
  --ud:
    unified Vite `buildApp({ ud: true })` with declared `client`, `api`, and `ssr`
      environments (web/dist/ + api/dist/ + api/dist/ud/, preserveModules, dedicated
      Vite plugins; Babel pass only when api/babel.config.js exists,
      adapter-free Fetchable at api/dist/ud/index.js) →
  prerender marked routes

*SSR/RSC: falls back to legacy separate builds; adds route hooks build, route
  manifest, SSR client+server builds.

Vite plugins: cell transform | entry injection | html env | data-uri-to-buffer shim |
  auto-imports | import-dir | directory-named-import | js-as-jsx | merged config |
  api-babel-transform | cedar-routes-auto-loader | cedar-universal-deploy |
  cedar-wait-for-api-server | resolve-cedar-style-imports
  *test mode (Vitest, mode === 'test'): adds router-import-transform |
    create-auth-import-transform | test auto-imports (mockGraphQLQuery etc.) |
    vitest-web-config (contributes a `test.setupFiles` entry that starts MSW,
    imports cell mocks and resets handlers between tests)
  *SSR/RSC: adds RSC transforms
```

## SERVER (PROD)

```
┌──────────────────┐      ┌──────────────────┐
│ Web Server       │      │ API Server       │
│ Fastify          │      │ Fastify          │
│ static files     │────▶│ Lambda functions │
│ SPA fallback     │proxy │ GraphQL Yoga     │
│ prerendered HTML │      │ custom server.ts │
└──────────────────┘      └──────────────────┘

*SSR/RSC: Web server uses Express (runFeServer) instead of Fastify.
```

## CLI

```
cedar
├── build [api,web]          ├── generate (g)
├── dev [api,web]            │   ├── cell│component│layout│page
├── check (diagnostics)      │   ├── sdl│service│directive│function
├── console (c)              │   ├── scaffold (pages+SDL+services)
├── deploy                   │   ├── script│job│dataMigration
│   ├── netlify│vercel       │   ├── types│realtime│og-image
│   └── render│serverless    │   └── secret│package│model
├── destroy (d) [mirror]     ├── setup
├── exec [script]            │   ├── auth <provider>
├── experimental             │   ├── vite│docker│i18n│jobs|neon
│   ├── rsc│streaming-ssr    │   ├── deploy│ui│cache│realtime
│   ├── live-queries         │   └── mailer│middleware│server-file
│   └── opentelemetry        │
├── info│jobs│lint           ├── test│type-check│upgrade
├── prerender│prisma [args]  ├── serve [api|web]
├── record│studio            └── ts-to-js (deprecated)
cedar new → yarn create cedar-app (standalone)
```

## SCAFFOLD OUTPUT (`cedar generate scaffold Post`)

```
api/src/graphql/posts.sdl.ts              <- schema only (types, queries, mutations, inputs)
api/src/services/posts/posts.ts           <- resolver implementations (typed against auto-generated types/graphql)
api/src/services/posts/posts.test.ts      <- tests
api/src/services/posts/posts.scenarios.ts <- test fixtures

web/src/components/Post/
  PostForm.tsx        ← form (uses @cedarjs/forms typed fields)
  PostCell.tsx        ← cell for show page
  EditPostCell.tsx    ← cell for edit page
  Posts.tsx           ← list component
  Post.tsx            ← show component
  PostsCell.tsx       ← cell for list page
  NewPost.tsx         ← new page component

web/src/pages/Post/
  PostPage.tsx        ← show
  EditPostPage.tsx    ← edit
  NewPostPage.tsx     ← new
  PostsPage.tsx       ← list

web/src/layouts/ScaffoldLayout/ScaffoldLayout.tsx  ← shared layout (if not exists)
web/src/lib/formatters.tsx                         ← formatting helpers
web/src/scaffold.css                               ← styles

Routes.tsx ← 4 routes added inside <Set wrap={ScaffoldLayout} title="Posts" ...>
```

## PACKAGES (behavioral)

| Package              | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core                 | Umbrella. Re-exports CLI, servers, testing, config. Bin shims.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| router               | JSX routing. `<Route path="/{id:Int}" page={P} name="r"/>`. Typed params, globs, redirects, `<Set>` layouts, `<PrivateSet>` auth guards. Named route helpers. Link/navigate/useLocation/useParams.                                                                                                                                                                                                                                                                                                                                                              |
| auth                 | Provider-agnostic. `createAuth(provider)` → {AuthProvider, useAuth}. State: loading/authenticated/user. \*SSR/RSC: ServerAuthProvider injects state for SSR.                                                                                                                                                                                                                                                                                                                                                                                                    |
| web                  | App shell. RedwoodProvider. createCell (GraphQL state→UI). Apollo (useQuery/useMutation). Head/MetaTags. FatalErrorBoundary. Toast. FetchConfig.                                                                                                                                                                                                                                                                                                                                                                                                                |
| api                  | Server runtime. Auth extraction. Validations (validate/validateWith). CORS. Logging (Pino). Cache (Redis/Memcached/InMemory). Webhooks. RedwoodError.                                                                                                                                                                                                                                                                                                                                                                                                           |
| graphql-server       | Yoga factory. Merge SDLs (schema) + services (resolvers) + directives + subscriptions. Armor. GraphiQL. useRequireAuth. Directive system (validator+transformer).                                                                                                                                                                                                                                                                                                                                                                                               |
| vite                 | cedar() → Vite plugins. Cell transform, entry injection, auto-imports. `apiDevMiddleware.ts` → Vite SSR dev server with inline fetch-native API dispatch (no Fastify) for `cedar dev --ud`. `buildCedarApp()` → unified `buildApp()` with declared `client` + `api` environments. `buildCedarApp({ ud: true })` → unified Vite build with `client` + `api` + `ssr` environments, adapter-free Fetchable at `api/dist/ud/index.js`. `cedarUniversalDeployPlugin` for UD build. \*SSR/RSC: adds Express + 2 Vite servers, RSC transforms, Hot Module Replacement. |
| cli                  | Yargs. 25+ commands. Generators for all types. Plugin system. Telemetry. .env loading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| forms                | react-hook-form wrapper. Typed fields. GraphQL coercion (valueAsBoolean/JSON). Error display.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| prerender            | Static Site Generation. renderToString at build, extract react-helmet meta tags, populate Apollo cache, write static HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| realtime             | Live queries + subscriptions. @live directive. createPubSub. InMemory/Redis stores.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| jobs                 | Background processing. JobManager/jobs/queues/workers. Delay/waitUntil/cron. Prisma adapter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| mailer               | Email. Core + handlers (nodemailer/resend/in-memory) + renderers (react-email/mjml).                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| storage              | File uploads. setupStorage→Prisma extension. FileSystem/Memory adapters. UrlSigner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| record               | ActiveRecord on Prisma. Validations, reflections, relations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| context              | Request-scoped context via AsyncLocalStorage. Proxy-based. Declaration merging.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| server-store         | Per-request store: auth state, headers, cookies, URL. \*SSR/RSC: used by middleware.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| gqlorm               | Prisma API → Proxy → GraphQL. useLiveQuery. Parser+generator.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| structure            | Project model (pages/routes/cells/services/SDLs). Diagnostics. ts-morph.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| codemods             | jscodeshift transforms. Version-organized (v2-v7). Cedar+migration from Redwood.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| testing              | Jest/Vitest config. MockProviders, MockRouter, mockGql, scenario helpers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| storybook            | Vite Storybook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| project-config       | Read cedar.toml. getPaths/getConfig/findUp.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| internal             | Re-exports project-config+babel-config. buildApi/buildApiWithVite/dev/generate. Route extraction.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| api-server           | Fastify. Auto-discover Lambda functions. Mount GraphQL. Custom server.ts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| web-server           | Fastify for web side. Uses fastify-web adapter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| fastify-web          | Fastify plugin. Static files, SPA fallback, API proxy, prerender.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| babel-config         | Presets/plugins for api+web. registerApiSideBabelHook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| eslint-config        | Flat config. TS+React+a11y+react-compiler+prettier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| eslint-plugin        | Rules: process-env-computed, service-type-annotations, unsupported-route-components.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| create-cedar-app     | Standalone scaffolding CLI. Interactive. TS/JS. Copies templates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| create-cedar-rsc-app | Standalone RSC scaffolding. Downloads template zip.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| telemetry            | Anonymous CLI telemetry. Duration/errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| tui                  | Terminal UI. spinners, boxes, reactive updates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ogimage-gen          | Vite plugin+middleware. OG images from React components.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| cookie-jar           | Typed cookie map. get/set/has/unset/serialize.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| utils                | Pluralization wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## THE FIVE CONTEXTS (`ctx` / `context` disambiguation)

`ctx` and `context` name five unrelated things in this codebase. Only #2 and #3
are the same data; the rest are entirely separate systems.

| #   | Name                      | Side | Where                                                          | What it is                                                                    |
| --- | ------------------------- | ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | MSW response transformers | web  | `packages/testing/src/web/mockRequests.ts`                     | Response **builder** in test/Storybook GraphQL mocks. Not request state.      |
| 2   | GraphQL resolver context  | api  | `packages/graphql-server/src/types.ts` (`CedarGraphQLContext`) | Yoga per-request context: `currentUser`, request, auth state.                 |
| 3   | Global `context`          | api  | `packages/context`                                             | AsyncLocalStorage-backed Proxy, auto-imported in services. Populated from #2. |
| 4   | Mocked global `context`   | api  | `packages/testing/src/api/mockContext.ts`                      | Test double for #3, so service tests run with no GraphQL server.              |
| 5   | Listr2 task `ctx`         | CLI  | `packages/cli/src/commands/**` (setup/generate/upgrade)        | Passes state between tasks in a listr2 task list.                             |

**1. MSW response transformers.** The `ctx` in `mockGraphQLQuery('Op', (variables, { ctx, req }) => ...)`
and in generated `*.mock.ts` cell mocks. In MSW v1 each `ctx.*` call returned a
`ResponseTransformer` composed into `res(...)`, so `ctx.data()` _constructs_ a
response body — it never reads request state. MSW v2 removed the pattern in
favour of returning an `HttpResponse`; Cedar reimplements the v1 shape on top of
v2 to keep existing mocks working. Web-side test scaffolding only — unrelated to
every other row despite the name.

**2. GraphQL resolver context.** graphql-js hands resolvers
`(root, args, context, info)`. Cedar remaps this so services read naturally,
in `makeMergedSchema.ts`:

```ts
// Map the arguments from GraphQL to an ordinary function a service would expect.
return services[name](args, { root, context, info })
```

Args move to first position (so a service destructures `{ id }` directly) and
the rest move into a bag in second position. The codegen mirrors this, which is
why generated `types/graphql.d.ts` has a custom `ResolverFn`:

```ts
export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  args?: TArgs,
  obj?: { root: TParent; context: TContext; info: GraphQLResolveInfo }
) => TResult | Promise<TResult>
```

**3. Global `context`.** Same data as #2, reached differently. The
`useRedwoodGlobalContextSetter` plugin copies the resolved GraphQL context into
the ALS store as it is built, so services can read `context.currentUser` without
threading it through every call. Services rarely destructure #2 — the second
parameter is the escape hatch for `root` and `info`, which the global doesn't
expose. See the next section for lifecycle details.

**Naming caution:** `mockCurrentUser()` exists on both sides with the same name —
web-side (in `mockRequests.ts`, registering an MSW handler for
`__CEDAR__AUTH_GET_CURRENT_USER`) and api-side (setting #4). User-facing docs
should say "MSW response transformers" rather than "ctx" when discussing #1, or
readers reasonably assume Cedar's `context` is changing.

## ALS WRAPPING & GLOBAL CONTEXT

Cedar provides two related but distinct mechanisms:

- **ALS wrapping** (`store.run(new Map(), ...)`) — ensures the AsyncLocalStorage
  store exists for the duration of a request. Needed because serverless
  environments (Netlify, Vercel) may reuse the same process across requests —
  without a fresh store per request, state from one request could leak into
  another. Also prevents the `context` proxy from crashing (without an active
  store, `getStore()` returns `undefined`).
- **`context`** (auto-imported from `@cedarjs/context`) — a Proxy that
  reads/writes from the ALS store. Exists so services deep in the GraphQL
  resolver chain can access `currentUser` without threading it through every
  function parameter.

`setContext()` populates the store with the resolved GraphQL context
(including `currentUser`) and is only called by the
`useRedwoodGlobalContextSetter` plugin
(`packages/graphql-server/src/plugins/useRedwoodGlobalContextSetter.ts:16`).
It's GraphQL-only because:

1. GraphQL has a plugin chain where `currentUser` is resolved once by
   `useRedwoodAuthContext` (from `ctx.serverAuthState`) and then made available
   to all downstream resolvers and directive validators via the store.
2. Regular functions are single-entry-point: they get the request, do one thing,
   return a response. Different function types handle auth differently, but none
   need `setContext()` for `currentUser`:

   - **Auth functions** (login/signup/logout): integral to the auth flow, but
     they create/destroy sessions by reading the request body and cookies
     directly. On login the user isn't authenticated yet; on logout the session
     is already in the cookie. `currentUser` is resolved _after_ these functions
     succeed, by the auth decoder on subsequent GraphQL requests.
   - **Webhooks** (Stripe, SendGrid): external POSTs with no Cedar auth context
     at all. No way to construct a `currentUser` from the request.
   - **Custom API endpoints**: if they need auth they decode the token or read
     the cookie themselves. Preferrably with the help of the `useRequireAuth()`
     hook.

| Path                                                      | Mechanism                | ALS wrapping | `setContext()`  | `context.currentUser` |
| --------------------------------------------------------- | ------------------------ | ------------ | --------------- | --------------------- |
| **Non-UD dev** — GraphQL                                  | Fastify `onRequest` hook | ✅           | ✅ plugin chain | ✅                    |
| **Non-UD dev** — Functions                                | Fastify `onRequest` hook | ✅           | ❌              | ❌ `undefined`        |
| **Non-UD serve/deploy** (baremetal/docker) — GraphQL      | Fastify `onRequest` hook | ✅           | ✅ plugin chain | ✅                    |
| **Non-UD serve/deploy** (baremetal/docker) — Functions    | Fastify `onRequest` hook | ✅           | ❌              | ❌ `undefined`        |
| **Non-UD deploy** (Netlify/Vercel serverless) — GraphQL   | ALS wrapping in output   | ✅           | ✅ plugin chain | ✅                    |
| **Non-UD deploy** (Netlify/Vercel serverless) — Functions | ALS wrapping in output   | ✅           | ❌              | ❌ `undefined`        |
| **UD dev** — GraphQL                                      | Middleware `store.run()` | ✅           | ✅ plugin chain | ✅                    |
| **UD dev** — Functions                                    | Middleware `store.run()` | ✅           | ❌              | ❌ `undefined`        |
| **UD built/deploy** — GraphQL                             | Generated `store.run()`  | ✅           | ✅ plugin chain | ✅                    |
| **UD built/deploy** — Functions                           | Generated `store.run()`  | ✅           | ❌              | ❌ `undefined`        |

## CONVENTIONS

- Config: `cedar.toml` (fallback `redwood.toml`)
- User project is a monorepo workspace: `["api", "web"]` (+ optional `packages/*`); framework monorepo: `["packages/*"]`
- Auto-imports (Vite plugin): `gql` from graphql-tag, `context` from @cedarjs/context, `React` from react
- Page auto-loading: `cedar-routes-auto-loader` (Vite plugin for dev/build; Babel plugin for Jest/prerender) scans `src/pages/` and auto-imports page components in `Routes.tsx`
- Components/services: manual imports
- `*Cell.tsx` → Vite plugin wraps in createCell() (exports QUERY+Loading+Success+Failure+Empty)
- `*.sdl.ts` → GraphQL schema ONLY (types, queries, mutations, inputs). Resolvers live in services/.
- `*.ts` in services/ → business logic (api/src/services/)
- `*.routeHooks.ts` → exports `routeParameters()` (prerendering: expands params for dynamic routes)
  and `meta()` (SSR/RSC only: per-request meta tag injection)
- Entry: `entry.client.tsx` (always). \*SSR/RSC: also `entry.server.tsx`
- Routes in `Routes.tsx` as JSX (virtual, never rendered — auto-loaded by `cedar-routes-auto-loader` Vite/Babel plugin)
- Build: default = esbuild (api) + Vite (web); `--ud` = unified Vite (`client` + `api` + `ssr` environments, `preserveModules: true`; api Babel pass only when api/babel.config.js exists)
- Server: API (Fastify by default; opt-in srvx via `cedar serve api --ud` or `cedar serve --ud`, which host the UD Fetchable from `api/dist/ud/index.js`). Web: Fastify (SPA). \*SSR/RSC: Web uses Express
- Package mgr: Yarn 4 (+ experimental support for npm and pnpm); Framework: Yarn 4 + Nx (build orchestration).
- Codegen: compile-time (Vite plugins) + on-demand (cedar-gen)
