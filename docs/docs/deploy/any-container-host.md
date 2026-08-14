---
description:
  Deploy to Railway, Render, Cloud Run, and other container hosts using
  Cedar's built-in build and start conventions
---

# Any Container Host

Cedar's
[single-container topology](./introduction.md#two-topologies-and-which-to-pick)
works out of the box, with no per-platform integration to write or maintain, on
any host that builds from a `package.json` and runs `yarn start`. That covers a
wide range of platforms:

- [Railway](./railway.md) (Railpack)
- Render
- Google Cloud Run
- DigitalOcean App Platform (Paketo)
- Heroku
- [Coolify](./coolify.md) (Nixpacks/Railpack)
- Dokku
- Dokploy
- Koyeb
- Northflank

None of these need a Cedar-specific `setup deploy` command — they all build and
run the same way.

## The conventions

Every generated Cedar app ships these `package.json` scripts:

```json
"build": "cedar build",
"dev": "cedar dev",
"start": "cedarjs-server",
"start:api": "cedarjs-server api",
"start:web": "cedarjs-server web"
```

A buildpack-style builder (Railpack, Nixpacks, Paketo, Google Cloud
buildpacks, Heroku's buildpack) finds `build` and `start` and runs them
automatically. `start` runs both sides in one process — the
[single-container topology](./introduction.md#two-topologies-and-which-to-pick)
— so there's no service-to-service wiring for the platform to get right.

The server also reads the two environment variables every container host sets
automatically:

- **`PORT`** — the port to listen on. Set by the platform; Cedar's public-facing
  side binds to it automatically.
- **`HOST`** — the host to bind. Cedar defaults to `::`, which binds dual-stack
  (IPv4 and IPv6) on hosts that support it, so this rarely needs to be set
  explicitly.

So the setup on any of these platforms is: connect the repo, point the build
command at `yarn build`, point the start command at `yarn start`, add a
`DATABASE_URL`. Nothing Cedar-specific beyond that — except migrations, which
every database-backed app needs regardless of platform. See below.

## Migrations

Every Cedar app with a database needs `yarn cedar prisma migrate deploy` run
once per deploy — after the build finishes, before the new version starts
taking traffic. This is the one piece that doesn't fit the "no
platform-specific setup" story above: there's no build-tool convention for
"run this command once, at the right moment, per deploy," so each platform
needs its own answer.

Don't run it from inside `start` if you have multiple replicas or overlapping
deploys. The instances could race to migrate the same database concurrently.

- Platforms with a dedicated pre-deploy or release hook (Railway's Pre-Deploy
  Command, Heroku's `release` phase in the `Procfile`) run it there — see
  [Railway](./railway.md#migrations).
- Platforms without one, like Coolify, fold it into the build command or run
  it as a one-off command against the deployed container — see
  [Coolify](./coolify.md#migrations).
- Render's `yarn cedar setup deploy render` generator already handles this
  for you — see [Render](./render.md).
- For a platform not documented here (Cloud Run, DigitalOcean, Dokku,
  Dokploy, Koyeb, Northflank), look for that platform's equivalent of a
  pre-deploy, release, or init hook before falling back to a manual one-off
  run.

## Custom server file caveat

If your app has a custom [server file](../server-file.md)
(`api/src/server.ts`), `start` won't work on any of these platforms — a
custom server file is a Fastify concept with no equivalent in the
single-container in-process server, so it refuses to start rather than
silently skipping what you configured. You'll need the
[two-service topology](./introduction.md#two-topologies-and-which-to-pick)
instead, which means per-platform wiring — see
[Railway](./railway.md) and [Coolify](./coolify.md).

## devDependency pruning caveat

Two platforms in the list above strip `devDependencies` after the build step
**by default**: **Heroku** and **DigitalOcean App Platform (Paketo)**. `start`
resolves the `cedarjs-server` bin from `@cedarjs/api-server`, which is a root
**dependency** (not a devDependency) specifically so this works — but if pruning
removes more than expected, or you've moved something into `devDependencies`
that `start` needs, you'll see the deploy succeed and the container fail
immediately with a "command not found" error.

If you hit that, disable pruning:

- **Heroku:** set `NPM_CONFIG_PRODUCTION=false` or `YARN_PRODUCTION=false`
- **DigitalOcean App Platform:** set `YARN2_SKIP_PRUNING=true` or
  `NPM_CONFIG_PRODUCTION=false`

The other platforms in the list (Railway, Render, Cloud Run, Coolify, Dokku,
Dokploy, Koyeb, Northflank) don't prune by default, so this doesn't apply to
them.

## Scaling up: the two-service topology

Every platform above can also run the
[recommended two-service topology](./introduction.md#two-topologies-and-which-to-pick)
— `start:api` and `start:web` as two separate services — once you outgrow
single-container. That split is inherently more platform-specific: the web
service needs to know where the api service lives, and how you wire that (a
proxy target, an internal DNS name, a private-network URL) differs per platform.
See [Railway](./railway.md) and [Coolify](./coolify.md) for two platforms where
that wiring is documented end to end.
