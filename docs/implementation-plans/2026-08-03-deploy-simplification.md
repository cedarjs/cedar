# Deploy Simplification (General + Railway)

Most of what makes Railway annoying isn't Railway — it's general gaps that any
container PaaS would hit. So the general list is where the leverage is; the
Railway-specific list nearly empties out if the general fixes land.

## The framing problem underneath all of it

Cedar is currently incoherent about `cedar serve`. The command binds `0.0.0.0`
in production, warns about "containerized deployments" (`webServer.ts:34`), and
looks production-ready — but no deploy path uses it, and Cedar's own docs say
the web server "isn't really configured for a high traffic, production website"
(`baremetal.md:654`).

Pick a side. Recommendation: **bless `cedar serve` as the supported
single-container topology** and fix the things that make it indefensible. That's
the shape every buildpack PaaS expects, and the two-service split becomes an
optimization you graduate into rather than the only blessed path. The
alternative — keep it local-only — means zero-config PaaS deploy is permanently
impossible for Cedar, which seems like the wrong trade.

Everything below assumes that choice.

## General deploy changes, ranked by leverage

**1. Read `PORT` and `HOST`.** `cliHelpers.ts:10-31` reads only
`REDWOOD_API_PORT`/`REDWOOD_WEB_PORT`. Railway, Render, Fly, Cloud Run, Heroku,
and App Runner all inject `PORT`. Today only the `--ud` api path honors it
(`serve.ts:306`) — an inconsistency that's arguably just a bug. Fallback chain:
`CEDAR_* → REDWOOD_* → PORT/HOST → cedar.toml → default`. This one change
removes a mandatory config step from every container host.

**2. Add `build` and `start` scripts to the app template.**
`create-cedar-app/templates/*/package.json` has no `scripts` key at all.
Railpack's detection is `start` script → `main` → `index.js`, and it runs
`build` if defined — so it finds nothing and you're forced into config-as-code.
Adding `"build": "cedar build"` and `"start": "cedar serve"` makes Cedar deploy
to Railway, Render, Fly, and Heroku with _zero_ config files. Combined with #1,
that's the whole game.

**3. Get runtime deps out of root `devDependencies`.** `@cedarjs/core` pulls in
`@cedarjs/cli` and `@cedarjs/api-server` (`core/package.json:51-52`) and lives
in devDependencies. So `RAILPACK_PRUNE_DEPS`, `npm prune --production`, or
`yarn workspaces focus --production` all break the start command with a
confusing "command not found." The thing you need to _run_ the server shouldn't
be a dev dependency.

**4. Make the web server production-defensible.**
`adapters/fastify/web/src/web.ts:26` is
`fastify.register(fastifyStatic, { root: getPaths().web.dist })` — no `maxAge`,
and `@fastify/compress` isn't a dependency of any package. Assets in
`web/dist/assets` are content-hashed and immutable, so
`Cache-Control: public, max-age=31536000, immutable` on that prefix (with
`no-cache` on `index.html`) is safe and near-free. Add compression too. This is
what turns "don't use this in production" into "this is fine behind any CDN."

**5. Dual-stack host default.** `cliHelpers.ts:6,23` defaults to `0.0.0.0` in
production — IPv4-only, which breaks IPv6-native private networking (Railway,
Fly). `::` accepts both on dual-stack. At minimum, document it; ideally default
to `::` and drop the `0.0.0.0` warning.

**6. A generic `setup deploy container` target.** The provider list is a
hardcoded enum, so every new PaaS needs a framework PR. But Railway, Fly, Koyeb,
Northflank, and Cloud Run all want the same three things: build command, start
command bound to `$PORT`, migration hook. One generic target plus thin provider
presets would cover the entire category.

**7. Built-in health endpoint.** Render's setup generates
`api/src/functions/healthz.js` (`renderHandler.ts:80`) — provider-specific, when
every container host wants one. Ship it always.

**8. Rename `REDWOOD_*` → `CEDAR_*` with aliases.** There are ~30 `CEDAR_*` vars
including `CEDAR_API_ROOT_PATH`, but the port/host vars were missed. Low value
functionally, real value for the fork's coherence.

**9. Document the three tiers.** `serve api` = production. `serve web` =
production behind a CDN/proxy. `serve` = single-container or local. This has to
be reverse-engineered from deploy templates today; it should be in
`deploy/introduction.md` and in `--help`.

## Railway-specific

If #1 and #2 ship, Railway deployment becomes: create service, add Postgres, set
`DATABASE_URL`, push. No config files at all. So the Railway-specific work is
mostly docs:

**`docs/docs/deploy/railway.md`** — the page that never existed. Cover the
single-service default; the two-service split as the scale-up path; enabling
Railway's CDN (the thing that actually compensates for #4); `preDeployCommand`
for migrations; and the `--host ::` private-networking gotcha, which is the one
genuinely Railway-shaped trap here.

**`yarn cedar setup deploy railway`** — worth it only as a preset on the generic
container target from #6, not as another bespoke provider. It'd emit the two
TOMLs, add `@prisma/adapter-pg`, and print the env vars to set.

**Don't** build a Railway-specific build path. Railpack handles Cedar's Yarn 4 +
workspaces + `engines.node` correctly already — each of those was verified
against Railpack's detection order. The gaps are all on Cedar's side.

## Sequencing

Start with #1 and #2 as a single PR — they're both small, they're the ones that
unlock every other container host, and the tests can point at the existing
`cliHelpers` suite. Hold #3 and #4 as separate PRs since they have real blast
radius.
