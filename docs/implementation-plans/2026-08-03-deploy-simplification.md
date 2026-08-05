# Deploy Simplification (General + Railway)

Started as "why is deploying to Railway annoying?" and became a general audit.
Most of what makes Railway annoying isn't Railway — it's gaps any container PaaS
hits. The general list is where the leverage is; the Railway-specific list
nearly empties out once the general fixes land.

This document has been updated as the work progressed. Items now link to the PRs
and issues that carry them, and several original conclusions have been revised —
those are called out rather than quietly edited, since the reasoning matters.

## The framing question — resolved

The original version of this doc said Cedar was incoherent about `cedar serve`:
the command binds `0.0.0.0` in production and warns about "containerized
deployments" (`webServer.ts:34`), yet no deploy path used it and Cedar's own
docs say the web server "isn't really configured for a high traffic, production
website" (`baremetal.md:654`). It asked for a decision.

**Decision:** bless single-container as the **convenient** topology, keep
api-process + static/CDN web as the **recommended** one. Recorded on #2294.

The reasoning that settled it: single-container needs no service-to-service
wiring, because the web server proxies to the api in-process. That is precisely
why one `start` script plus `PORT` handling yields working deploys on Railway,
Render, Cloud Run, DigitalOcean App Platform, Heroku, Coolify, Dokku, Dokploy,
Koyeb and Northflank with no per-platform integration to write or maintain —
though two of those ten need one extra env var set first; see "Platform
landscape" below.

Genuine zero-config with a _separate_ api service is not achievable. The two
services must be wired to each other — a proxy target, or `apiUrl` pointing at a
domain that doesn't exist until after the first deploy — and that wiring is
irreducibly deployment-specific. Railway's JS monorepo autodetection comes
closest (it stages a service per package, keeps the monorepo root, and uses
workspace-filtered commands) but still leaves the proxy target unset, and it's
Railway-only.

## Status

| #   | Item                                       | Status                                         |
| --- | ------------------------------------------ | ---------------------------------------------- |
| 1   | Read `PORT` and `HOST`                     | **Done** — #2292                               |
| 2   | `build` / `start` scripts in templates     | #2294 done; switch to `cedarjs-server` — #2323 |
| 3   | Runtime deps out of root `devDependencies` | Reframed — #2295 superseded by #2312/#2313     |
| 4   | Web server cache headers + compression     | #2301                                          |
| 5   | Dual-stack host default                    | Open                                           |
| 6   | Generic `setup deploy container`           | **Superseded** — #2303                         |
| 7   | Built-in health endpoint                   | #2298                                          |
| 8   | Rename `REDWOOD_*` → `CEDAR_*`             | **Done** — #2292                               |
| 9   | Document the serve tiers                   | #2300                                          |

Also opened along the way: #2296, #2297, #2299, #2302.

## 1. Read `PORT` and `HOST` — done (#2292)

`cliHelpers.ts` read only `REDWOOD_API_PORT` / `REDWOOD_WEB_PORT`. Every
container host injects `PORT`; only the `--ud` api path honoured it.

Resolved with a `CEDAR_* → REDWOOD_* → PORT/HOST → cedar.toml → default` chain.
The important refinement over the original plan: `PORT` applies to the **public
side only**, via an `isPublicSide` option. Without that, `cedar serve` would
have had both listeners bind `PORT` and collide.

## 2. `build` / `start` scripts — PR #2294

Generated apps had no `scripts` key at all, so zero-config builders (Railpack,
Nixpacks, Paketo, Google Cloud buildpacks, Heroku) found nothing to run.

Shipping five scripts rather than the two originally planned:

```json
"build": "cedar build",
"dev": "cedar dev",
"start": "cedarjs-server",
"start:api": "cedarjs-server api",
"start:web": "cedarjs-server web"
```

`start` is the single-container path; `start:api` / `start:web` are the
two-service path, so platform config can call standard scripts instead of
`cedar deploy <provider>` glue.

**Considered and rejected:** `start` scripts in `api/package.json` and
`web/package.json`. Railway's monorepo autodetection would pick them up, but
it's Railway-only and still leaves the proxy target unset — a half-staged
two-service deploy that fails until you find the right setting is worse than one
service that works immediately.

`#2302` was the blocker (`cedarjs-server` skipped server files) — fixed by
#2318. The scripts now run through `@cedarjs/api-server`'s `cedarjs-server` bin
directly, with `@cedarjs/api-server` added as a root **dependency**, in #2323.
See item 3 below for why that dependency has to be a runtime one, not a dev one.

## 3. Runtime deps out of `devDependencies` — reframed

**The original prescription was wrong.** It implied promoting `@cedarjs/core`,
which reviewers correctly rejected — core is the whole CLI and build toolchain
and belongs in `devDependencies`.

The correct framing is that the scripts split by phase: `build` and `dev` are
build-time and should use the CLI from `devDependencies`; only `start` is a
runtime concern. The fix is to stop routing `start` through the CLI at all — add
`@cedarjs/api-server` as a root **dependency** and use the `cedarjs-server` bin.
Cedar already does exactly this in `setup docker`, which adds
`@cedarjs/api-server` and `@cedarjs/web-server` to the api and web workspaces.
The root-scripts case only needs `@cedarjs/api-server` — its `cedarjs-server`
bin has a `web` subcommand that calls straight into `@cedarjs/web-server`'s own
handler, so there's no need for a second explicit dependency there.
(`setup docker` adds both separately because its `web_serve` image never
installs the api workspace at all, so it can't reach `@cedarjs/api-server`
transitively.)

**This is not cosmetic.** Heroku's Node buildpack and DigitalOcean/Paketo both
strip `devDependencies` after build **by default**, so `start: cedar serve`
fails on those platforms: build succeeds, deploy succeeds, container starts,
command not found. Railway only works because `RAILPACK_PRUNE_DEPS` is opt-in.

`#2302` was the blocker (`cedarjs-server` didn't do the server-file dispatch
that `cedar serve` does) — fixed by #2318. Root dependency + script switch
landed in #2323.

## 4. Web server cache headers and compression — #2301

`adapters/fastify/web/src/web.ts:26` is
`fastify.register(fastifyStatic, { root: getPaths().web.dist })` — no `maxAge`,
no compression, and `@fastify/compress` is not a dependency of any package.

Assets in `web/dist/assets` are content-hashed, so
`Cache-Control: public, max-age=31536000, immutable` is safe there, with
`no-cache` on `index.html`.

Raised in priority by the framing decision: blessing single-container means more
people serve assets through Fastify rather than a CDN, and telling someone their
zero-config deploy needs a CDN bolted on undercuts the point. Note `srvx/static`
on the UD path is equally bare, so any fix should consider both.

## 5. Dual-stack host default — open

`cliHelpers.ts` still defaults to `0.0.0.0` in production, which is IPv4-only.
Railway's private network is IPv6-native, so the two-service topology needs an
explicit `--host ::` on the api service. `::` accepts both on dual-stack.

Either default to `::` and drop the `0.0.0.0` warning, or document the gotcha
prominently. This is the single most likely thing to break a first Railway
two-service deploy.

## 6. Generic `setup deploy container` — superseded by #2303

The original argument was that one generic target plus thin presets beats a
hardcoded provider enum. Tracing it through, that doesn't survive contact with
the platforms: once the conventions land there is almost nothing left to emit.
Coolify is dashboard-only, Cloud Run is `gcloud` flags, Heroku is at most a
`Procfile` containing `web: yarn start`, and Dokku/Dokploy/Koyeb/Northflank need
nothing. Only Railway, DigitalOcean and Fly have a config file, and all three
are different.

What _is_ worth extracting: `yarn cedar setup neon` already performs the whole
SQLite → Postgres migration, and only one of its eleven steps (provisioning) is
Neon-specific. Pulling the provider-agnostic part out serves every container
deploy — it's the biggest manual step in any non-SQLite deployment. Tracked in
#2303.

## 7. Built-in health endpoint — #2298

`setup deploy render` generates `api/src/functions/healthz.js`, but the
generated `render.yaml` never references it — there is no `healthCheckPath`
field at all, so the file is inert.

Verified by booting the Fastify server and injecting requests:

| Request                  | Result                 |
| ------------------------ | ---------------------- |
| `GET /graphql/health`    | 200, `x-yoga-id: yoga` |
| `GET /graphql/readiness` | 503                    |

So `/graphql/health` is usable as a health check path. `/graphql/readiness` is
not — `createGraphQLYoga.ts:183-194` requires the _request_ to carry a matching
`x-yoga-id` header, so a plain platform health check gets 503.

## 8. `REDWOOD_*` → `CEDAR_*` — done (#2292)

Port and host vars now read `CEDAR_*` first with `REDWOOD_*` as deprecated
aliases.

## 9. Document the serve tiers — #2300

Folded into one consolidated docs issue along with the topology framing, a
Railway page, a Coolify page, an "any container host" page, and fixes for stale
`yarn rw` usages across the deploy docs.

## Discoveries not in the original plan

**`@cedarjs/web-server` is already the model.** It depends only on
`fastify-web`, `project-config`, fastify and small utilities — no build
toolchain. `@cedarjs/api-server` was one import away from matching it; that
import was `@cedarjs/internal` in the dev watcher, now an optional peer
dependency (#2295). "Make api-server look like web-server" turned out to be a
much smaller ask than "split up api-server".

**`@cedarjs/project-config` pulls `@prisma/internals`** (#2296) — Prisma's
CLI-side internals, not `@prisma/client`. It sits on every runtime path,
including the otherwise-clean `@cedarjs/web-server`. Already dynamically
imported, and no server touches the code that needs it.

**`cedarjs-server` silently ignores server files** (#2302). This is a live bug,
not a future one: the generated Dockerfile already uses `cedarjs-server api` as
its `CMD`, so a project with Realtime configured deploys today with no
subscriptions and no indication anything is wrong.

**The Render deploy command must stay.** An earlier revision of #2297 proposed
deleting it in favour of Render's `preDeployCommand`. It carries a guard that
nothing else in the CLI does: `@cedarjs/cli-data-migrate` is a CLI _plugin_
(`plugin.ts:60`), so without it the `dataMigrate` command doesn't exist, and the
guard also warns about the memory cost of installing it mid-deploy. #2297 is now
blueprint modernization only.

**The GraphQL plugin fails silently** (#2299). If options extraction bails, or
plugin setup throws, the plugin registers zero routes and the whole GraphQL
endpoint 404s — the outer catch is a bare `console.log(e)`. For an opinionated
framework the right behaviour is to fail loudly at build time.

**Universal Deploy is a parallel mode, not a successor.** Per
`cedar-serve-ud-both-sides-plan.md`, `cedar serve api --ud` is the production
entry (srvx hosting `api/dist/ud/index.js`, behind nginx), `cedar serve --ud` is
local testing only, and Fastify was explicitly decided against for the UD api
side. The `@cedarjs/cli` dependency on the local-testing path is therefore fine.

**If `--ud` ever becomes the default**, the api half of zero-config is solved
structurally: the UD entry inlines framework glue via `.toString()`, so it
imports nothing from `api-server`, `internal`, `cli` or `project-config`, and
#2296 becomes moot for the serve path. The gap moves to the web half —
single-container means one runtime serving both sides, which is exactly the case
`virtual:cedar-web` was built for before being removed as unreachable dead code
(see the Phase 6 Addendum in `universal-deploy-integration-plan-refined.md`,
which includes a recipe for restoring it). Custom server files remain the open
product question, since UD ignores them by design.

**Platform landscape.** Ten hosts work purely on conventions, but not uniformly
— `start` resolves the `cedar` bin from a root **devDependency** (#2302 tracks
moving it onto a runtime one), and two of the ten prune devDependencies by
default before running `start`:

- **Zero-config, no caveats:** Railway (Railpack), Render, Cloud Run, Coolify,
  Dokku, Dokploy, Koyeb, Northflank.
- **Supported, one env var needed:** **Heroku** and **DigitalOcean App Platform
  (Paketo)** both strip `devDependencies` after build by default, so `start`
  fails with "command not found" unless pruning is disabled —
  `NPM_CONFIG_PRODUCTION=false` / `YARN_PRODUCTION=false` on Heroku,
  `YARN2_SKIP_PRUNING=true` / `NPM_CONFIG_PRODUCTION=false` on DigitalOcean.

Fly.io is Dockerfile-first — its own docs call buildpacks "brittle, bloated, and
prone to change" — and is already served by `setup docker`. Coolify is the
standout for self-hosters: its Static build pack alongside Nixpacks means it can
natively express Cedar's _recommended_ topology rather than forcing
single-container.

## Railway-specific

Once #2 and #3 land, Railway becomes: create service, add Postgres, set
`DATABASE_URL`, push. So the Railway work is mostly docs (#2300).

Verified about Railway: Railpack is the default builder (Nixpacks deprecated),
and it handles Cedar's Yarn 4 + workspaces + `engines.node` correctly. Config as
code is `railway.json` / `railway.toml` — **no JSONC**, so use TOML when you
want comments. `preDeployCommand` suits migrations. Railway's CDN is
per-service, free on all plans, and caches static assets by `Content-Type` — the
thing that most compensates for #4. Private networking is IPv6-native, hence #5.

**`yarn cedar setup deploy railway`** — worth it only as a thin preset once
#2303 lands, not as another bespoke provider.

**Don't** build a Railway-specific build path. The gaps are all on Cedar's side.

## Sequencing

1. **#2302** — `cedarjs-server api` runs the server file; modes that can't, fail
   loudly. Blocks the rest, and fixes a live bug. **Done**, via #2318.
2. **#2295** — `@cedarjs/internal` to an optional peer, so the new root
   dependency is lean. Independent of 1, same release. **Superseded**, by
   #2312/#2313 (split `@cedarjs/api-server-watch` out instead).
3. **#2294** — add the root `@cedarjs/api-server` dependency, switch the scripts
   to `cedarjs-server`. #2294 shipped the scripts as `cedar serve`; the switch
   to `cedarjs-server` landed in #2323, once unblocked by 1 and 2.
4. **#2301** and **#5** — the two things that make the blessed single-container
   path actually good.
5. **#2303**, then docs (#2300).

#2296, #2297, #2298 and #2299 are independent and can land whenever.
