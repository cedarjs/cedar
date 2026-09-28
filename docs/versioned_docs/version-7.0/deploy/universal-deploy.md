---
description: Deploy anywhere with Universal Deploy
---

# Universal Deploy

Universal Deploy is a standard for deploying web applications to any hosting provider using a portable, Fetch-native server entry. Instead of provider-specific build outputs, your app exposes a single `fetch(request)` handler that hosting providers can wrap with their own adapter.

CedarJS integrates with Universal Deploy via `cedarUniversalDeployPlugin()` in your Vite config, which builds a standard server entry alongside your app.

## Setup

Run the setup command to add the plugin to your Vite config:

```shell
yarn cedar setup deploy universal-deploy
```

This adds `cedarUniversalDeployPlugin()` to your `web/vite.config.ts`.

## Build and serve locally

Build the Universal Deploy server entry:

```shell
yarn cedar build --ud
```

Serve it locally to verify everything works before deploying:

```shell
yarn cedar serve --ud
```

## Supported production topologies

Universal Deploy supports two production topologies:

1. **Serverless platforms that natively host Fetchables** — Netlify and Vercel. The platform's own adapter wraps the UD entry directly; see below.
2. **A cloud VM or container, with a reverse proxy in front** — nginx (or your platform's equivalent) serves `web/dist/` static files directly, and proxies API routes to a Node process running the UD entry via [srvx](https://github.com/h3js/srvx):

   ```shell
   yarn cedar build --ud
   yarn cedar serve api --ud
   ```

   `cedar serve api --ud` is the production entry point for the api side — it's what belongs behind your reverse proxy. Use `--api-port` and `--api-host` to configure the listener; `--api-host` defaults to `::` (dual-stack), which works on any container host without configuration.

`yarn cedar serve --ud` (no side specified — both api and web in one process) is **local production-like testing only**, for verifying a `cedar build --ud` output before deploying. It is not one of the two production topologies above — in real production, web assets are always served by a separate process (a CDN, nginx, or the platform's static hosting), not by the UD entry itself.

### Custom server files aren't supported under `--ud`

A custom `api/src/server.ts` is a Fastify concept — Realtime, custom plugins, and custom middleware registered there have no equivalent in the UD entry (a plain Fetchable), so there's no way to honor it. If Cedar detects `api/src/server.ts`, `--ud` refuses to serve rather than silently producing a different app than what's configured:

```
api/src/server.ts was detected, but a custom server file is not supported
with --ud. It is a Fastify concept — anything registered there (Realtime,
custom plugins, custom middleware) would silently be skipped if serving
continued.
```

## Deploying to a provider

Once Universal Deploy is set up, configure your hosting provider:

### Netlify

```shell
yarn cedar setup deploy netlify --ud
```

This installs `@netlify/vite-plugin` and `@universal-deploy/netlify`, adds the required Vite plugins, and writes a `netlify.toml` configured for Universal Deploy.

### Vercel

```shell
yarn cedar setup deploy vercel --ud
```

This installs `vite-plugin-vercel`, adds the Vercel Vite plugin, and writes a `vercel.json` configured for Universal Deploy.

## API route prefix

When deploying with Universal Deploy, API routes (your functions under
`api/src/functions/`) need a URL prefix to avoid colliding with your web app's
SPA routes. For example, a `hello` function should be accessible at
`/.api/functions/hello`, not `/hello`.

Two related but distinct concepts control this:

### `apiUrl` (`cedar.toml`)

```toml
[web]
  apiUrl = "/.api/functions"
```

`apiUrl` is a **web-side configuration** that tells the Cedar web server which
URL paths should be proxied to the API server. In the browser,
`globalThis.RWJS_API_URL` is set to this value so your web code knows where to
send API requests.

During local testing with `yarn cedar serve --ud` or `yarn cedar serve web`,
the web server (port 8910) intercepts requests matching `apiUrl`, **strips the
prefix**, and forwards them to the API server (port 8911). So a browser request
to `http://localhost:8910/.api/functions/hello` reaches the API server as
`/hello`.

### `--apiRootPath` (CLI flag)

```
yarn cedar build --ud --apiRootPath=/.api/functions
```

`--apiRootPath` is a **build-time configuration** for the
`cedarUniversalDeployPlugin`. It determines the route prefix baked into the
Universal Deploy server entry (`api/dist/ud/index.js`).

When the flag is not passed, `apiRootPath` defaults to `/`, meaning routes are
registered at `/hello`, `/graphql`, etc. This is correct for local development
where the web dev server strips the prefix before forwarding.

When deploying to a serverless provider (Netlify, Vercel), the provider routes
requests at the prefixed path directly to your functions. There is no dev server
to strip the prefix, so you must set `--apiRootPath=/.api/functions` so routes
are registered at `/.api/functions/hello`, matching how the provider forwards
requests.

Both `yarn cedar setup deploy netlify --ud` and
`yarn cedar setup deploy vercel --ud` configure this automatically in their
build commands.

### `CEDAR_API_ROOT_PATH` (environment variable)

```shell
CEDAR_API_ROOT_PATH=/.api/functions yarn cedar build --ud
```

The `CEDAR_API_ROOT_PATH` environment variable can be used instead of the
`--apiRootPath` CLI flag. It takes precedence over any value set in
`cedarUniversalDeployPlugin` options, but the `--apiRootPath` CLI flag takes
precedence over the environment variable when both are set. This is useful for
CI/CD environments where you want to configure the prefix via environment
injection without modifying source files or build commands.

### Summary

| Concept                                       | Where set                           | Precedence               | Purpose                                                                      | Typical value                                   |
| --------------------------------------------- | ----------------------------------- | ------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `apiUrl`                                      | `cedar.toml` `[web]` section        | —                        | Tells the browser and web dev server where the API lives                     | `/.api/functions`                               |
| `--apiRootPath`                               | CLI flag on `yarn cedar build --ud` | Highest                  | Controls the route prefix baked into the UD server entry                     | `/.api/functions` (deploy), not set (local dev) |
| `CEDAR_API_ROOT_PATH`                         | Environment variable                | Overrides plugin options | Overrides `cedarUniversalDeployPlugin` options without modifying vite config | `/.api/functions`                               |
| `cedarUniversalDeployPlugin({ apiRootPath })` | Vite config                         | Lowest                   | Configure the route prefix in the plugin options                             | —                                               |

## How it works

The `--ud` build step (`yarn cedar build --ud`) produces a server entry at `api/dist/ud/index.js` that exports:

```ts
export default {
  fetch(request: Request): Response | Promise<Response>
}
```

This is the [WinterTC](https://wintertc.org/) minimum common API — the same interface used by Cloudflare Workers, Deno Deploy, Bun, and others. Hosting provider adapters wrap this entry to handle their specific runtime environment.

On the API side, GraphQL, auth, and your Cedar functions are all served through this single handler. On the web side, SSR (if configured) runs in the same process.

## Troubleshooting

**`Universal Deploy server entry not found`**

You need to run `yarn cedar build --ud` before `yarn cedar serve --ud`. The `--ud` flag serves the pre-built entry — it does not build it on demand.

**`cedarUniversalDeployPlugin is already configured`**

The setup command detected the plugin is already present and skipped the step. No action needed — your Vite config is already set up correctly.
