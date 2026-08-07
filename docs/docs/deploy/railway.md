---
description: Deploy to Railway, single-service or split into api/web services
---

# Deploy to Railway

Railway builds with [Railpack](https://railpack.com) by default (Nixpacks is
deprecated), and it handles Cedar's Yarn 4 workspaces and `engines.node`
correctly with no configuration. Cedar needs nothing beyond the conventions
described in [any container host](./any-container-host.md) to deploy there.

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
3. On the web service, set the start command to pass `--api-proxy-target`, a
   fully-qualified URL (scheme required) pointing at the api service:

   ```shell
   yarn start:web --api-proxy-target=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
   ```

   Swap in `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` to keep this
   traffic off the public internet instead (Railway's private network doesn't
   terminate TLS, so use `http://`). The port is required here —
   `RAILWAY_PRIVATE_DOMAIN` is a bare hostname, and unlike the public domain
   (where Railway's edge proxy forwards to your app's actual port for you),
   private-network traffic connects to that port directly. Either way, replace
   `api` with your api service's actual name — Railway resolves
   `${{<service>.<VAR>}}` at deploy time. A missing or schemeless
   `apiProxyTarget` leaves `apiUrl` requests unhandled and Cedar returns a Bad
   Gateway error.

## Config as code

Railway supports config-as-code via `railway.json` or `railway.toml` in your
repo. There's no JSONC support, so if you want comments in your config, use
`railway.toml`.

## Private networking

Railway's private network is IPv6-native. Cedar's servers default to binding
`::` (dual-stack — both IPv4 and IPv6), so the two-service topology's internal
service-to-service traffic works with no host configuration on your part.
