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

## Deploying to a provider

Once Universal Deploy is set up, configure your hosting provider:

### Node.js (cloud server, VPS, container)

No additional setup needed. After building, serve directly with:

```shell
yarn cedar build --ud
yarn cedar serve --ud
```

This runs the server using [srvx](https://github.com/h3-org/srvx) — a portable HTTP server that wraps the Fetch-native entry. Use `--api-port`, `--api-host`, `--web-port`, and `--web-host` to configure the listeners:

```shell
yarn cedar serve --ud --api-port 8911 --api-host 0.0.0.0 --web-port 8910 --web-host 0.0.0.0
```

For production on a cloud VM or container, build once and run `cedar serve --ud` as your process entry point (behind a reverse proxy or load balancer as needed).

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
