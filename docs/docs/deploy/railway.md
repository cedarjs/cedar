---
description: Deploy to Railway, split into api/web services (or a single container)
---

# Deploy to Railway

Railway builds with [Railpack](https://railpack.com) by default, and it handles
Cedar's Yarn 4 workspaces and `engines.node` correctly with no configuration.
Cedar needs nothing beyond the conventions described in
[any container host](./any-container-host.md) to deploy there.

## Two services

When you create a new Railway project from a GitHub repo with Yarn workspaces,
Railway's import detects `api` and `web` as separate deployable services,
matching Cedar's
[recommended topology](./introduction.md#two-topologies-and-which-to-pick) for a
production Cedar app. Before your first deploy, follow the steps below.

1. Create a new Railway project from your Cedar repo. Railway creates an `api`
   and a `web` service.
2. Add a Postgres database from Railway's plugin catalog.
3. On the **api** service:
   - Settings tab, Start Command: `yarn start:api`
   - Settings tab, Healthcheck Path: `/graphql/health`.
   - Variables tab: `PORT=8911`
   - Variables tab: reference the database, usually
     `DATABASE_URL=${{Postgres.DATABASE_URL}}`
4. On the **web** service:
   - Variables tab: whatever database URL(s) `api/prisma.config.cjs` references
     — usually `DATABASE_URL`, plus possibly `DIRECT_DATABASE_URL`.
   - Variables tab:
     `API_PROXY_TARGET=${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}`. Define it
     as a Variable first, since Railway's `${{Service.VAR}}` syntax doesn't
     resolve directly in the Start Command field.
   - Settings tab, Start Command:

     ```shell
     yarn start:web --api-proxy-target="http://$API_PROXY_TARGET"
     ```

     This requires `apiUrl` in `cedar.toml` to stay relative — see
     [relative vs. absolute apiUrl](./introduction.md#relative-apiurl--proxy-or-absolute-apiurl--cors).

   - Settings tab → Networking → Public Networking → **Generate Domain**.
     Railway doesn't expose a public URL by default; this is what gives you one
     (a free `*.up.railway.app` subdomain, or add your own custom domain here
     instead).

5. Deploy. Railpack finds each service's `build`/`start` scripts and runs them —
   no further build configuration needed.

It might seem starange to have to add `DATABASE_URL` to the web service. But
it's used for prerendering. During build Cedar will execute Cell queries against
your database to generate the static HTML it serves when prerendering.

This two-services topology is the only one that supports a custom
[server file](../server-file.md) (`api/src/server.ts`) — it's a Fastify concept
with no equivalent in the single-container in-process server, so `yarn start`
refuses to start rather than silently skipping what you configured (Realtime,
custom plugins, custom middleware).

## Migrations

Set the **api** service's **Pre-Deploy Command** (in its Settings tab) to run
migrations before the new deploy goes live:

```shell
yarn cedar prisma migrate deploy
```

Railway runs this once per deploy, before traffic is switched over.

## Enabling Railway's CDN

Railway's CDN is per-service, free on all plans, and caches static assets by
`Content-Type`. Enable it on the **web** service's Settings tab under Networking
— `yarn start:web` still serves `web/dist` from a Node process, so the CDN is
what gets static assets edge-cached instead of round-tripping through that
process on every request.

## Single-container (optional)

If you'd rather run one service instead of two — fewer moving parts, lower cost,
no proxy wiring — you can consolidate down to Cedar's
[single-container topology](./introduction.md#two-topologies-and-which-to-pick).
This isn't Railway's default: its GitHub import creates the two services
described above, so getting to one means undoing that.

1. Delete one of the two auto-created services, keeping the other.
2. On the remaining service, check Settings → Source and clear any
   root-directory override, so it builds from the repo root rather than the
   `api` or `web` workspace.
3. Add Postgres and reference `DATABASE_URL` as above.
4. Push. Railpack runs the root `build`/`start` scripts, which serve both sides
   from one process.

Single-container doesn't support a custom server file (see above). Railway's CDN
still applies the same way — enable it on the one remaining service.

## Config as code

Railway supports config-as-code via `railway.json` or `railway.toml` in your
repo. There's no JSONC support, so if you want comments in your config, use
`railway.toml`.
