---
description: Deploy to Railway, single-service or split into api/web services
---

# Deploy to Railway

Railway builds with [Railpack](https://railpack.com) by default, and it handles
Cedar's Yarn 4 workspaces and `engines.node` correctly with no configuration.
Cedar needs nothing beyond the conventions described in
[any container host](./any-container-host.md) to deploy there.

## Single-service (start here)

1. Create a new Railway project, and add a service from your Cedar repo.
2. Add a Postgres database from Railway's plugin catalog. Railway sets
   `DATABASE_URL` on services in the same project automatically — check your
   service's Variables tab to reference it (usually
   `${{Postgres.DATABASE_URL}}`).
3. Push. Railpack finds `build` and `start` in `package.json` and runs them — no
   build or start command configuration needed.

That's the whole setup: create service, add Postgres, reference `DATABASE_URL`,
push. This runs the
[single-container topology](./introduction.md#two-topologies-and-which-to-pick)
— one service serving both sides.

## Migrations

Set your service's **Pre-Deploy Command** (in the service's Settings tab) to run
migrations before the new deploy goes live:

```shell
yarn cedar prisma migrate deploy
```

Railway runs this once per deploy, before traffic is switched over, which is a
better fit than trying to run migrations from inside `start`.

## Custom server file

If your app has a custom [server file](../server-file.md) (`api/src/server.ts`),
single-service won't work — a custom server file is a Fastify concept with no
equivalent in the single-container in-process server, so `start` refuses to
start rather than silently skipping what you configured (Realtime, custom
plugins, custom middleware). Skip straight to
[scaling up to two services](#scaling-up-two-services) below, and set the api
service's start command to `yarn start:api` — that path does run the server
file.

## Enabling Railway's CDN

Railway's CDN is per-service, free on all plans, and caches static assets by
`Content-Type`. Enable it in your service's Settings tab under Networking. It's
the thing that most closes the gap between single-container and the two-service
topology — even serving `web/dist` from the same process as your api, static
assets still get edge-cached.

## Scaling up: two services

To split into the
[recommended topology](./introduction.md#two-topologies-and-which-to-pick):

1. Add a second service from the same repo.
2. On the api service, set the start command to `yarn start:api`.
3. Set the web service's start command to proxy to the api service with
   `--api-proxy-target`, a fully-qualified URL (scheme required). Requires
   `apiUrl` in `cedar.toml` to stay relative — see
   [relative vs. absolute apiUrl](./introduction.md#relative-apiurl--proxy-or-absolute-apiurl--cors).

   Define the target as a Variable first, then reference it from the start
   command (Railway's `${{Service.VAR}}` syntax doesn't resolve directly in the
   Start Command field):

   - Api service **Variables** tab: `PORT=8911`
   - Web service **Variables** tab:
     `API_PROXY_TARGET=${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`, replacing
     `api` with your api service's actual Railway service name
   - Web service start command:

     ```shell
     yarn start:web --api-proxy-target="http://$API_PROXY_TARGET"
     ```

   A missing or schemeless `apiProxyTarget` returns a Bad Gateway error.

## Config as code

Railway supports config-as-code via `railway.json` or `railway.toml` in your
repo. There's no JSONC support, so if you want comments in your config, use
`railway.toml`.
