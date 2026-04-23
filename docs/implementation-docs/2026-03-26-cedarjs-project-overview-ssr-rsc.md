# CEDARJS — SSR/RSC EXPERIMENTAL (reference doc)

_Supplement to [MAIN-DOC]. Consult when SSR (`experimental.streamingSsr`)
or RSC (`experimental.rsc`) is enabled in `cedar.toml`._

> **[MAIN-DOC]** = `docs/implementation-docs/2026-03-26-cedarjs-project-overview.md`

---

## AUTH FLOW (SSR/RSC)

```
Server (Express)                           Client
┌──────────────────────────────┐    ┌──────────────────────────────┐
│  middleware chain runs:      │    │  ServerAuthProvider injects  │
│    auth-provider cookie ─────┼────▶ state as <script> tag       │
│    → select decoder         │    │                              │
│    → decode session/token   │    │  AuthProvider mounts:        │
│    → getCurrentUser(id)     │    │    serverAuthState exists    │
│    → set serverAuthState    │    │    useEffect:                │
│    in AsyncLocalStorage      │    │      1. restoreAuthState()   │
│                              │    │      2. SKIP reauthenticate()│
│  auth endpoints:             │    │      (state already from srv)│
│    /middleware/{provider}/   │    │                              │
│    login│signup│logout|...   │    │  Auth immediately available  │
└──────────────────────────────┘    └──────────────────────────────┘

DECODER INTERFACE (all providers implement this):
  (token: string, type: string, req: {event}) → Promise<decoded | null>

PROVIDERS: dbAuth(cookie), Auth0/Clerk/SuperTokens(JWKS), Firebase(admin SDK),
           Supabase(cookie+JWT), Netlify(Lambda context), AzureAD(JWKS)
```

---

## MIDDLEWARE

```
REGISTRATION (entry.server.tsx):
  export async function registerMiddleware() {
    return [
      initDbAuthMiddleware({ dbAuthHandler, getCurrentUser, cookieName }),  // [mw, '*']
      customMiddleware,                                                      // bare function
    ]
  }

INVOCATION (every request):
  Request → createMiddlewareRouter() → find(method, url) → invoke(req, matchedMw)
    → new MiddlewareRequest(req)   ← extends Request + cookies (CookieJar) + serverAuthState
    → middleware(mwReq, mwRes, options)
    → setServerAuthState() in AsyncLocalStorage

MIDDLEWARE SIGNATURE:
  (req: MiddlewareRequest, res: MiddlewareResponse, options?) → MiddlewareResponse | void

MIDDLEWARERESPONSE CAPABILITIES:
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ return MiddlewareResponse.next()        ← pass through, continue chain │
  │ return MiddlewareResponse.redirect(url) ← 302, skip React render       │
  │ res.shortCircuit(body, init)            ← return early, skip everything│
  │ res.cookies.set(name, value, opts)      ← set cookie                   │
  │ res.cookies.unset(name)                 ← clear cookie                 │
  │ res.headers.set(name, value)            ← set header                   │
  │ res.body = content                      ← set body (skips React)       │
  │ req.serverAuthState.set({currentUser..})← set auth for SSR             │
  │ void / no return                        ← same as next()               │
  └─────────────────────────────────────────────────────────────────────────┘

CHAINING: middleware for same route pattern are chained in order; output of one
becomes input of next. Auth middleware typically runs first (sets serverAuthState
for SSR). Route patterns: '*' (all), '/api/*', etc. Registered via [middleware, pattern] tuple.
```

---

## REQUEST LIFECYCLE (SSR)

```
Browser ──GET──▶ Express ──▶ AsyncLocalStorage(per-req store)
                                    │
                            Vite SSR Dev Server (HMR, static)
                                    │
                            matchPath(URL, routes)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼              ▼              ▼
              SPA fallback    SSR handler     POST handler
              (index.html)    (streaming)     (auth endpoints)
                                    │
                            middleware chain (auth, custom)
                                    │
                            entry.server → route hooks
                                    │
                            renderToReadableStream()
                            ┌───────┴───────┐
                            ▼              ▼
                     ServerApp tree   bootstrap scripts
                     (AuthProvider    CSS links
                      + Router        asset map
                      + Page)
                                    │
                            HTML stream → Browser

PROD: same but pre-built bundles + route-manifest.json → chunks
      optional: prerendered HTML served directly, SSR uses Express not Vite
```

---

## DATA LOADING (RSC Server Cells)

```
SERVER CELL (RSC)
┌───────────────────┐
│ *Cell.tsx         │
│ export data (fn)  │
│ export Loading    │
│ export Success    │
│                   │
│ createServerCell  │
│  → async comp    │
│  → await data()  │
│  → render direct │
│  → <Suspense>    │
└───────────────────┘
```

---

## DEV / BUILD (SSR/RSC differences)

```
cedar dev:
  cedar-vite-dev runs Express with 2 Vite SSR servers (1 for SSR, 1 for RSC)

cedar build:
  Web build modes:
    SPA (1 build)
    SSR (client + server builds)
    RSC (6 steps: analyze → client → SSR → server → CSS → mappings)
```

---

## SERVER (PROD)

```
┌──────────────────┐      ┌──────────────────┐
│ Web Server       │      │ API Server       │
│ Express (SSR)    │      │ Fastify          │
│ static files     │────▶│ Lambda functions │
│ streaming render │proxy │ GraphQL Yoga     │
│ route hooks      │      │ custom server.ts │
└──────────────────┘      └──────────────────┘
* SSR/RSC uses Express (runFeServer). SPA uses Fastify (fastify-web).
```

---

## ENTRY POINTS

- `entry.client.tsx` — always required
- `entry.server.tsx` — required for SSR/RSC (absent in SPA). Exports `registerMiddleware()`
  and `ServerEntry` (the streaming SSR handler).

---

## ROUTE HOOKS (shared with prerendering)

```
NAMING: web/src/pages/{Name}Page/{Name}Page.routeHooks.ts (PLURAL "s")

EXPORTS:
  export async function routeParameters() {
    return [{ id: 2 }, { id: 3 }]  // used by PRERENDERING to expand dynamic params
  }

  export async function meta(event) {
    return [{ title: 'My Page' }]   // used by SSR/RSC only (per-request meta injection)
  }

PRERENDERING (SPA):
  routeParameters() → expands /blog-post/{id:Int} into /blog-post/2, /blog-post/3
  → each path prerendered as static HTML using react-helmet for meta

SSR/RSC:
  meta(event) → called per-request → tag arrays injected into <head> at runtime
```
