---
description: Deploy to serverless or serverful providers
---

# Introduction to Deployment

Cedar is designed for both serverless and traditional infrastructure deployments, offering a unique continuous deployment process in both cases:

1. code is committed to a repository on GitHub, GitLab, or Bitbucket, which triggers the deployment
2. the Cedar API Side and Web Side are individually prepared via a build process
3. during the build process, any database related actions are run (e.g. migrations)
4. the hosting provider deploys the built Web static assets to a CDN and the API code to a serverless backend (e.g. AWS Lambdas)

Currently, these are the officially supported deploy targets:

- Baremetal (physical server that you have SSH access to)
- [Coherence](https://www.withcoherence.com/)
- [Flightcontrol.dev](https://www.flightcontrol.dev?ref=redwood)
- [Netlify.com](https://www.netlify.com/)
- [Render.com](https://render.com)
- [Serverless.com](https://serverless.com)
- [Vercel.com](https://vercel.com)

Beyond these, [any container host](./any-container-host.md) — Railway, Google Cloud Run, DigitalOcean App Platform, Heroku, Coolify, Dokku, Dokploy, Koyeb, Northflank — works from the same set of conventions Cedar ships with by default, with no provider-specific integration required. See the dedicated pages for [Railway](./railway.md) and [Coolify](./coolify.md).

Cedar has a CLI generator that adds the code and configuration required by the specified provider (see the [CLI Doc](cli-commands.md#deploy-config) for more information):

```shell
yarn cedar setup deploy <provider>
```

There are examples of deploying CedarJS on other providers such as Google Cloud and direct to AWS. You can find more information by searching the [CedarJS GitHub Issues](https://github.com/cedarjs/cedar/issues) and [RedwoodJS Forums](https://community.redwoodjs.com).

## The `serve` command tiers

`yarn cedar serve` has several forms, depending on which side(s) you're serving and whether you're using [Universal Deploy](./universal-deploy.md). It's worth knowing all of them, since the role each one plays isn't obvious from the command name alone:

| Command                | Role                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cedar serve api`      | Production. Web side served separately — by nginx, a CDN, or a static host.                                                                                          |
| `cedar serve web`      | Production, behind a CDN or reverse proxy. Proxies API requests to `cedar serve api`.                                                                                |
| `cedar serve`          | Single-container: both sides in one process. Also useful for local production-like testing.                                                                          |
| `cedar serve api --ud` | Production, using [Universal Deploy](./universal-deploy.md). Runs `api/dist/ud/index.js` via [srvx](https://github.com/h3js/srvx), behind a reverse proxy.           |
| `cedar serve --ud`     | Local production-like testing only, for a Universal Deploy build. Not a production topology — see [Universal Deploy](./universal-deploy.md#deploying-to-a-provider). |

The generated `package.json` scripts map onto these: `start` is `cedar serve` (single-container), `start:api` is `cedar serve api`, `start:web` is `cedar serve web`.

## Two topologies, and which to pick

Once you're past `cedar dev`, there are two ways to run Cedar in production:

- **Single-container** (`yarn start`) — one process serves both sides; the web server proxies API requests to the API in-process. This is the **convenient** path: no service-to-service wiring, so it works with zero configuration on any container host — see [any container host](./any-container-host.md).
- **api process + static/CDN web** (`yarn start:api`, with the web side served separately) — this is the **recommended** path, and what the generated Dockerfile, the baremetal nginx setup, and the Render blueprint all use.

Start with single-container — it's the fastest way to get a working deploy, and for small apps or early-stage projects it's often all you need. Move to the two-part topology when you want your web assets served from a CDN edge (rather than round-tripping through your api process), or when you want to scale the api and web sides independently. The reason this needs to be stated explicitly: without it, it's easy to land on single-container, get a working app, and never learn why the split is worth doing later.

:::important
If your app has a custom [server file](../server-file.md) (`api/src/server.ts`),
single-container isn't an option — it's a Fastify concept with no equivalent in
the single-container in-process server, so `yarn start` refuses to start rather
than silently skipping what you configured. Use the two-service topology
(`yarn start:api` / `yarn start:web`) instead.
:::

## General Deployment Setup

Deploying Cedar requires setup for the following four categories.

### 1. Host Specific Configuration

Each hosting provider has different requirements for how (and where) the deployment is configured. Sometimes you'll need to add code to your repository, configure settings in a dashboard, or both. You'll need to read the provider specific documentation.

The most important Cedar configuration is to set the `apiUrl` in your `cedar.toml` This sets the API path for your serverless functions specific to your hosting provider.

### 2. Build Command

The build command is used to prepare the Web and API for deployment. Additionally, other actions can be run during build such as database migrations. The Cedar build command must specify one of the supported hosting providers (aka `target`):

```shell
yarn cedar deploy <target>
```

For example:

```shell
# Build command for Netlify deploy target
yarn cedar deploy netlify
```

```shell
# Build command for Vercel deploy target
yarn cedar deploy vercel
```

```shell
# Build command for AWS Lambdas using the https://serverless.com framework
yarn cedar deploy serverless --side api
```

```shell
# Build command for baremetal deploy target
yarn cedar deploy baremetal [--first-run]
```

### 3. Prisma and Database

Cedar uses Prisma for managing database access and migrations. The settings in
`api/db/schema.prisma` must include the correct deployment database, e.g.
postgresql.

To use PostgreSQL in production, include this in your `schema.prisma`:

```jsx
datasource db {
  provider = "postgresql"
}
```

The database URL is configured both in the Prisma config file (`api/prisma.config.cjs`) via the `datasource.url` option using `env('DATABASE_URL')` and in `api/src/lib/db.{ts,js}` when constructing the Prisma client. Using env vars is the recommended method for both ease of development process as well as security best practices.

Whenever you make changes to your `schema.prisma`, you must run the following command:

```shell
yarn cedar prisma migrate dev # creates and applies a new Prisma DB migration
```

> Note: when setting your production DATABASE_URL env var, be sure to also set any connection-pooling or sslmode parameters. For example, if using Supabase Postgres with pooling, then you would use a connection string similar to `postgresql://postgres:mydb.supabase.co:6432/postgres?sslmode=require&pgbouncer=true` that uses a specific 6432 port, informs Prisma to consider pgBouncer, and also to use SSL. See: [Connection Pooling](connection-pooling.md) for more info.

### 4. Environment Variables

Any environment variables used locally, e.g. in your `env.defaults` or `.env`, must also be added to your hosting provider settings. (See documentation specific to your provider.)

Additionally, if your application uses env vars on the Web Side, you must configure Cedar's build process to make them available in production. See the [Cedar Environment Variables doc](environment-variables.md) for instructions.
