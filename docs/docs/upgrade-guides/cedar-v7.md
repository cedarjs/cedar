---
title: CedarJS v7.0.0
description: A small major release with a handful of low-risk breaking changes
toc_max_heading_level: 4
---

## Highlights

CedarJS v7 is a small major release. It ships a handful of breaking changes
that are low risk for most apps, ahead of the larger changes planned for v8
(ESM-only projects, React 19 and Apollo Client 4). Everything else in this
release is bug fixes and dependency updates.

### OpenTelemetry SDK 2.x

`@cedarjs/cli` and `create-cedar-app` use the OpenTelemetry JS SDK 2.x for
Cedar's anonymous usage telemetry. The 1.x SDK depends on
`@opentelemetry/propagator-jaeger` 1.x, which is affected by
[GHSA-45rx-2jwx-cxfr](https://github.com/advisories/GHSA-45rx-2jwx-cxfr)
(CVE-2026-59892). The 2.x SDK has no dependency on that package, so the
advisory is gone from a Cedar project's audit output.

### Security fixes in dependencies

Besides the OpenTelemetry upgrade, this release moves off dependency versions
with published advisories: Nodemailer 9
([GHSA-p6gq-j5cr-w38f](https://github.com/advisories/GHSA-p6gq-j5cr-w38f) and
four moderate advisories), MJML 5
([GHSA-45h5-66jx-r2wf](https://github.com/advisories/GHSA-45h5-66jx-r2wf)),
react-server-dom-webpack 19.2.8
([GHSA-wx67-qw84-cm4g](https://github.com/advisories/GHSA-wx67-qw84-cm4g)) and
uuid 11.1.1
([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)).
Nodemailer 9 and MJML 5 are major versions with small behaviour changes, see
the breaking changes below.

### Route hooks are built with Vite

`web/src/**/*.routeHooks.{js,jsx,ts,tsx}` files are built with Vite and the same
plugins as the rest of the web side, so `src/`, `$api/` and directory-named
imports and auto-imported `gql` all resolve the way they do elsewhere in the
app.

## Upgrade Guide

### Breaking changes

Skim the list below, find the ones that apply to your app, then follow the
steps in [Let's get started](#lets-get-started).

- **[OpenTelemetry SDK 2.x in `setup-opentelemetry`
  projects](#opentelemetry-sdk-2x-in-setup-opentelemetry-projects)**
- **[redis v6](#redis-v6)**
- **[Nodemailer 9](#nodemailer-9)**
- **[MJML mailer renderer uses MJML 5](#mjml-mailer-renderer-uses-mjml-5)**
- **[ESLint parses JavaScript with
  typescript-eslint](#eslint-parses-javascript-with-typescript-eslint)**
- **[JSX is only compiled in `.jsx` and `.tsx`
  files](#jsx-is-only-compiled-in-jsx-and-tsx-files)**
- **[Route hooks are built with Vite](#route-hooks-are-built-with-vite-1)**
- **[`yarn cedar setup tsconfig` removed](#yarn-cedar-setup-tsconfig-removed)**
- **[`yarn cedar ts-to-js` removed](#yarn-cedar-ts-to-js-removed)**

If you want to see every single change in this release, including all the PRs
that went into it, check the
[release notes on GitHub](https://github.com/cedarjs/cedar/releases/tag/v7.0.0).

### Let's get started!

#### Begin with the latest v6

It's always best to start from the latest previous version. Make sure you're on
v6.0.2 (the latest v6 release) and everything is working as expected before
upgrading to v7:

```bash
yarn cedar upgrade -t 6.0.2
```

#### Running the upgrade command

Now you're ready to upgrade to v7:

```bash
yarn cedar upgrade
```

The upgrade runs a pre-upgrade check that lists every `.js` file on the web
side that contains JSX. If it finds any, rename them to `.jsx` and run the
command again.

If you want to try a pre-release/RC build instead, target `rc`:

```bash
yarn cedar upgrade -t rc
```

#### OpenTelemetry SDK 2.x in `setup-opentelemetry` projects

`yarn cedar experimental setup-opentelemetry` writes an `api/src/opentelemetry.ts`
that uses the SDK 2.x API. The `@opentelemetry/*` packages in `api/package.json`
and the setup file belong to your project, so upgrading Cedar leaves them
alone. To move an existing setup to the 2.x SDK, bump every `@opentelemetry/*`
dependency in `api/package.json` to its latest version and update
`api/src/opentelemetry.ts`:

- `Resource.default()` and `new Resource(attrs)` are replaced by the
  `defaultResource()` and `resourceFromAttributes(attrs)` functions from
  `@opentelemetry/resources`.
- `SemanticResourceAttributes.SERVICE_NAME` and `SERVICE_VERSION` are replaced by
  the `ATTR_SERVICE_NAME` and `ATTR_SERVICE_VERSION` constants from
  `@opentelemetry/semantic-conventions`.
- `provider.addSpanProcessor(processor)` is gone. Pass the processors to the
  provider's constructor instead: `new NodeTracerProvider({ resource,
spanProcessors: [processor] })`.

#### redis v6

`@cedarjs/api`'s optional Redis cache client uses the `redis` npm package v6,
so projects that use `RedisClient` need `redis@^6` in `api/package.json`. Redis
v6 speaks RESP3 by default, applies a 5 second default command timeout where v5
had none, and uses a 30 second `keepAliveInitialDelay` instead of 5. None of
this changes what `RedisClient`'s own `get`, `set` and `del` calls return, but
an app talking to a Redis server that is slow to answer individual commands can
see timeouts it did not see before. To keep the v5 behaviour, pass
`commandOptions: { timeout: 0 }` (or a timeout of your choice) in the
`RedisClientOptions` you give the cache client, and `RESP: 2` to stay on the v5
wire protocol. See the
[redis v5 to v6 migration guide](https://github.com/redis/node-redis/blob/master/docs/v5-to-v6.md)
for the full list of changes.

#### Nodemailer 9

`@cedarjs/mailer-handler-nodemailer` uses Nodemailer 9. The handler API is
unchanged, but Nodemailer now validates TLS certificates when it fetches
remote content over HTTPS: attachments with an `href` or `path` URL, OAuth2
token endpoints and HTTP proxy `CONNECT` requests. Fetching from a host with a
self-signed, expired or hostname-mismatched certificate fails where it used to
succeed. Opt out per transport with `tls: { rejectUnauthorized: false }` in
the transport options, or per attachment with the attachment's `tls` option.

#### MJML mailer renderer uses MJML 5

`@cedarjs/mailer-renderer-mjml-react` renders with MJML 5 and
`@faire/mjml-react` 4. Rendering is asynchronous, which `Mailer.send` handles
transparently; only code that calls `MJMLReactRenderer.render()` directly
needs to `await` the result. MJML 5 minifies with htmlnano and cssnano,
generates the `<body>` tag from `mj-body` (the `class` attribute lands on
`<body>`, `background-color` only on the inner `div`), ignores `mj-include`
unless `includePath` is configured, and accepts any string for
`border-radius`. Expect small differences in the generated HTML if you
compare rendered output byte for byte.

#### ESLint parses JavaScript with typescript-eslint

`@cedarjs/eslint-config` parses `.js` and `.jsx` files with typescript-eslint's
parser, the same parser it uses for `.ts` and `.tsx` files, and no longer
depends on `@babel/eslint-parser`, `@babel/eslint-plugin` or `@babel/core`.
Standard ES syntax coverage is the same, and JSX in `.js` files still parses,
but scope analysis can differ in cosmetic edge cases around JSX identifiers, so
a project can see a few new or a few fewer lint findings. A project that
imports `@babel/eslint-parser` in its own ESLint config has to add it to its
own `package.json`.

#### JSX is only compiled in `.jsx` and `.tsx` files

Vite compiles JSX only in files with a `.jsx` or `.tsx` extension. A `.js`
file on the web side that contains JSX fails `yarn cedar build web` with a
parse error (`Expression expected`) pointing at the first JSX tag. Rename such
files to `.jsx`. The pre-upgrade check run by `yarn cedar upgrade` lists every
`.js` file it finds JSX in.

#### Route hooks are built with Vite

Route hooks are bundled with Vite as ES modules, one output file per hook, and
the files under `web/dist/ssr/routeHooks` mirror the layout of `web/src`:
`web/src/pages/AboutPage/AboutPage.routeHooks.ts` is built to
`pages/AboutPage/AboutPage.routeHooks.js`, and modules shared between hooks
land in `chunks/`. In a CommonJS web side (no `"type": "module"` in
`web/package.json`) the files get the `.mjs` extension. Nothing changes for
apps that only reference route hooks through the route manifest, which is what
streaming SSR does. Tooling that reads the built files directly has to use the
new layout.

#### `yarn cedar setup tsconfig` removed

The `setup tsconfig` CLI command, which added `tsconfig.json` files to an
existing JavaScript project so it could start using TypeScript, has been
removed. Choose TypeScript up front with `yarn create cedar-app --typescript`,
or convert an existing JavaScript project manually—see
[Converting a JavaScript Project to TypeScript](../typescript/introduction.md#converting-a-javascript-project-to-typescript).

#### `yarn cedar ts-to-js` removed

The deprecated `ts-to-js` CLI command, which converted a TypeScript project to
JavaScript, has been removed. Cedar has no built-in way to convert a project
from TypeScript to JavaScript. If you need a JavaScript project, generate one
with `yarn create cedar-app --no-typescript`.

### Things to watch out for

#### Prisma Client

Make sure you've generated a new Prisma client once you've upgraded. Even though
the upgrade regenerates the client, you may need to run
`yarn cedar prisma generate` again to avoid errors.
