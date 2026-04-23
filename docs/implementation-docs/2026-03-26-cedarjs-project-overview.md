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
┌──────────────▼─────────────────────────────▼───────────────────────┐
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
│ version:   24    │  7   │    5    │       3       │   7    │ 18/19   │
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
│               (index.html)                   (services use @cedarjs/context)  │
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
  concurrently ─┬─ nodemon → api-server (Fastify, port from toml)
                └─ cedar-gen-watch (regenerate types on SDL or Prisma schema
                   change)

*SSR/RSC: rw-vite-dev adds Express + Vite SSR servers. See [SSR-RSC-DOC].

cedar build:
  prisma gen → GraphQL types → validate SDLs →
  API (esbuild→api/dist/) → Web (Vite→web/dist/) → prerender marked routes

*SSR/RSC: adds route hooks build, route manifest, SSR client+server builds.

Vite plugins: cell transform | entry injection | html env | node polyfills |
  auto-imports | import-dir | js-as-jsx | merged config
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
├── experimental             │   ├── vite│docker│i18n│jobs
│   ├── rsc│streaming-ssr    │   ├── deploy│ui│cache│realtime
│   └── opentelemetry        │   └── mailer│middleware│server-file
├── info│jobs│lint           ├── test│type-check│upgrade
├── prerender│prisma [args]  ├── serve [api|web]
├── record│studio            └── ts-to-js (deprecated)
cedar new → yarn create cedar-app (standalone)
```

## SCAFFOLD OUTPUT (`cedar generate scaffold Post`)

```
api/src/graphql/posts.sdl.ts              ← schema only (types, queries, mutations, inputs)
api/src/services/posts/posts.ts           ← resolver implementations (typed against auto-generated types/graphql)
api/src/services/posts/posts.test.ts      ← tests
api/src/services/posts/posts.scenarios.ts ← test fixtures

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

| Package              | Behavior                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| core                 | Umbrella. Re-exports CLI, servers, testing, config. Bin shims.                                                                                                                                                                                         |
| router               | JSX routing. `<Route path="/{id:Int}" page={P} name="r"/>`. Typed params, globs, redirects, `<Set>` layouts, `<PrivateSet>` auth guards. Named route helpers. Link/navigate/useLocation/useParams.                                                     |
| auth                 | Provider-agnostic. `createAuth(provider)` → {AuthProvider, useAuth}. State: loading/authenticated/user. \*SSR/RSC: ServerAuthProvider injects state for SSR.                                                                                           |
| web                  | App shell. RedwoodProvider. createCell (GraphQL state→UI). Apollo (useQuery/useMutation). Head/MetaTags. FatalErrorBoundary. Toast. FetchConfig.                                                                                                       |
| api                  | Server runtime. Auth extraction. Validations (validate/validateWith). CORS. Logging (Pino). Cache (Redis/Memcached/InMemory). Webhooks. RedwoodError.                                                                                                  |
| graphql-server       | Yoga factory. Merge SDLs (schema) + services (resolvers) + directives + subscriptions. Armor. GraphiQL. useRequireAuth. Directive system (validator+transformer).                                                                                      |
| vite                 | cedar() → Vite plugins. Cell transform, entry injection, auto-imports. \*SSR/RSC: adds Express + 2 Vite servers, RSC transforms, Hot Module Replacement.                                                                                               |
| cli                  | Yargs. 25+ commands. Generators for all types. Plugin system. Telemetry. .env loading.                                                                                                                                                                 |
| forms                | react-hook-form wrapper. Typed fields. GraphQL coercion (valueAsBoolean/JSON). Error display.                                                                                                                                                          |
| prerender            | Static Site Generation. renderToString at build, extract react-helmet meta tags, populate Apollo cache, write static HTML.                                                                                                                             |
| realtime             | Live queries + subscriptions. @live directive. createPubSub. InMemory/Redis stores.                                                                                                                                                                    |
| jobs                 | Background processing. JobManager/jobs/queues/workers. Delay/waitUntil/cron. Prisma adapter.                                                                                                                                                           |
| mailer               | Email. Core + handlers (nodemailer/resend/in-memory) + renderers (react-email/mjml).                                                                                                                                                                   |
| storage              | File uploads. setupStorage→Prisma extension. FileSystem/Memory adapters. UrlSigner.                                                                                                                                                                    |
| record               | ActiveRecord on Prisma. Validations, reflections, relations.                                                                                                                                                                                           |
| context              | Request-scoped context via AsyncLocalStorage. Proxy-based. Declaration merging.                                                                                                                                                                        |
| server-store         | Per-request store: auth state, headers, cookies, URL. \*SSR/RSC: used by middleware.                                                                                                                                                                   |
| gqlorm               | Prisma API → Proxy → GraphQL. useLiveQuery. Parser+generator.                                                                                                                                                                                          |
| structure            | Project model (pages/routes/cells/services/SDLs). Diagnostics. ts-morph.                                                                                                                                                                               |
| codemods             | jscodeshift transforms. Version-organized (v2-v7). Cedar+migration from Redwood.                                                                                                                                                                       |
| testing              | Jest/Vitest config. MockProviders, MockRouter, mockGql, scenario helpers.                                                                                                                                                                              |
| storybook            | Vite Storybook.                                                                                                                                                                                                                                        |
| project-config       | Read cedar.toml. getPaths/getConfig/findUp.                                                                                                                                                                                                            |
| internal             | Re-exports project-config+babel-config. buildApi/dev/generate. Route extraction.                                                                                                                                                                       |
| api-server           | Fastify (default) + srvx/WinterTC (opt-in via `cedar serve api --ud` or `cedar-ud-server` binary). Auto-discover Lambda functions. Mount GraphQL. Custom server.ts. srvx path uses `buildCedarDispatcher` + `createUDServer` for Fastify-free serving. |
| web-server           | Fastify for web side. Uses fastify-web adapter.                                                                                                                                                                                                        |
| fastify-web          | Fastify plugin. Static files, SPA fallback, API proxy, prerender.                                                                                                                                                                                      |
| babel-config         | Presets/plugins for api+web. registerApiSideBabelHook.                                                                                                                                                                                                 |
| eslint-config        | Flat config. TS+React+a11y+react-compiler+prettier.                                                                                                                                                                                                    |
| eslint-plugin        | Rules: process-env-computed, service-type-annotations, unsupported-route-components.                                                                                                                                                                   |
| create-cedar-app     | Standalone scaffolding CLI. Interactive. TS/JS. Copies templates.                                                                                                                                                                                      |
| create-cedar-rsc-app | Standalone RSC scaffolding. Downloads template zip.                                                                                                                                                                                                    |
| telemetry            | Anonymous CLI telemetry. Duration/errors.                                                                                                                                                                                                              |
| tui                  | Terminal UI. spinners, boxes, reactive updates.                                                                                                                                                                                                        |
| ogimage-gen          | Vite plugin+middleware. OG images from React components.                                                                                                                                                                                               |
| cookie-jar           | Typed cookie map. get/set/has/unset/serialize.                                                                                                                                                                                                         |
| utils                | Pluralization wrapper.                                                                                                                                                                                                                                 |

## CONVENTIONS

- Config: `cedar.toml` (fallback `redwood.toml`)
- User project is a monorepo workspace: `["api", "web"]` (+ optional `packages/*`); framework monorepo: `["packages/*"]`
- Auto-imports (Vite plugin): `gql` from graphql-tag, `context` from @cedarjs/context, `React` from react
- Page auto-loading: Babel plugin scans `src/pages/` and auto-imports page components in `Routes.tsx`
- Components/services: manual imports
- `*Cell.tsx` → Vite plugin wraps in createCell() (exports QUERY+Loading+Success+Failure+Empty)
- `*.sdl.ts` → GraphQL schema ONLY (types, queries, mutations, inputs). Resolvers live in services/.
- `*.ts` in services/ → business logic (api/src/services/)
- `*.routeHooks.ts` → exports `routeParameters()` (prerendering: expands params for dynamic routes)
  and `meta()` (SSR/RSC only: per-request meta tag injection)
- Entry: `entry.client.tsx` (always). \*SSR/RSC: also `entry.server.tsx`
- Routes in `Routes.tsx` as JSX (virtual, never rendered — Babel auto-loads pages)
- Build: Vite (web), esbuild (api)
- Server: API default Fastify; opt-in srvx (`cedar serve api --ud` / `cedar-ud-server`) via Universal Deploy integration. Web: Fastify (SPA). \*SSR/RSC: Web uses Express
- Package mgr: Yarn 4 (+ experimental support for npm and pnpm); Framework: Yarn 4 + Nx (build orchestration).
- Codegen: compile-time (Vite plugins) + on-demand (cedar-gen)
