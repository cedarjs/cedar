---
description:
  Deploy to Railway, Render, Cloud Run, and other container hosts with zero
  configuration
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

A zero-config builder (Railpack, Nixpacks, Paketo, Google Cloud buildpacks,
Heroku's buildpack) finds `build` and `start` and runs them without further
input. `start` runs both sides in one process — the
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
`DATABASE_URL`. Nothing Cedar-specific beyond that.

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
