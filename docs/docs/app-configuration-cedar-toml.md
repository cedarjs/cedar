---
title: App Configuration
description: Configure your app with cedar.toml
---

# App Configuration: cedar.toml

One of the premier places you can configure your Cedar app is `cedar.toml`. By
default, `cedar.toml` lists the following configuration options:

```toml title="cedar.toml"
[web]
  title = "Cedar App"
  port = 8910
  apiUrl = "/.api/functions"
  includeEnvironmentVariables = []
[api]
  port = 8911
[browser]
  open = true
[notifications]
  versionUpdates = ["latest"]
```

These are listed by default because they're the ones that you're most likely to configure, but there are plenty more available.

You can think of `cedar.toml` as a frontend for configuring Cedar's build tools.
For certain options, instead of having to configure build tools directly, there's quick access via `cedar.toml`.

## [web]

| Key                           | Description                                                                                                     | Default               |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------- | :-------------------- |
| `title`                       | Title of your Cedar app                                                                                         | `'Cedar App'`         |
| `port`                        | Port for the web server to listen at                                                                            | `8910`                |
| `apiUrl`                      | URL to your api server. This can be a relative URL in which case it acts like a proxy, or a fully-qualified URL | `'/.api/functions'`   |
| `includeEnvironmentVariables` | Environment variables made available to the web side during dev and build                                       | `[]`                  |
| `host`                        | Hostname for the web server to listen at                                                                        | `'::'`                |
| `apiGraphQLUrl`               | URL to your GraphQL function                                                                                    | `'${apiUrl}/graphql'` |
| `apiDbAuthUrl`                | URL to your dbAuth function                                                                                     | `'${apiUrl}/auth'`    |
| `sourceMap`                   | Enable source maps for production builds                                                                        | `false`               |
| `a11y`                        | Enable storybook `addon-a11y` and `eslint-plugin-jsx-a11y`                                                      | `true`                |

### Customizing the GraphQL Endpoint

By default, Cedar derives the GraphQL endpoint from `apiUrl` such that it's `${apiUrl}/graphql`, (with the default `apiUrl`, `./api/functions/graphql`).
But sometimes you want to host your api side somewhere else.
There's two ways you can do this:

1. Change `apiUrl`:

```toml title="cedar.toml"
[web]
  apiUrl = "https://api.coolcedarapp.com"
```

Now the GraphQL endpoint is at `https://api.coolcedarapp.com/graphql`.

2. Change `apiGraphQLUrl`:

```diff title="cedar.toml"
 [web]
   apiUrl = "/.api/functions"
+  apiGraphQLUrl = "https://api.coolcedarapp.com/graphql"
```

### Customizing the dbAuth Endpoint

Similarly, if you're using dbAuth, you may decide to host it somewhere else.
To do this without affecting your other endpoints, you can add `apiDbAuthUrl` to
your `cedar.toml`:

```diff title="cedar.toml"
 [web]
   apiUrl = "/.api/functions"
+  apiDbAuthUrl = "https://api.coolcedarapp.com/auth"
```

:::tip

If you host your web and api sides at different domains and don't use a proxy,
make sure you have [CORS](./cors.md) configured.
Otherwise browser security features may block client requests.

:::

### includeEnvironmentVariables

`includeEnvironmentVariables` is the set of environment variables that should be available to your web side during dev and build.
Use it to include env vars like public keys for third-party services you've defined in your `.env` file:

```toml title="cedar.toml"
[web]
  includeEnvironmentVariables = ["PUBLIC_KEY"]
```

```text title=".env"
PUBLIC_KEY=...
```

Instead of including them in `includeEnvironmentVariables`, you can also prefix them with `REDWOOD_ENV_` (see [Environment Variables](environment-variables.md#web)).

:::caution[`includeEnvironmentVariables` isn't for secrets]

Don't make secrets available to your web side. Everything in `includeEnvironmentVariables` is included in the bundle.

:::

## [api]

| Key            | Description                              | Default                               |
| :------------- | :--------------------------------------- | :------------------------------------ |
| `port`         | Port for the api server to listen at     | `8911`                                |
| `host`         | Hostname for the api server to listen at | `'::'`                                |
| `prismaConfig` | Path to the Prisma configuration file    | Defaults to `./api/prisma.config.cjs` |
| `debugPort`    | Port for the debugger to listen at       | `18911`                               |

Additional server configuration can be done using [Server File](docker.md#using-the-server-file)

## [browser]

```toml title="cedar.toml"
[browser]
  open = true
```

Setting `open` to `true` opens your browser to `http://${web.host}:${web.port}` (by default, `http://localhost:8910`) after the dev server starts.
If you want your browser to stop opening when you run `yarn rw dev`, set this to `false`.
(Or just remove it entirely.)

There's actually a lot more you can do here. For more, see Vite's docs on [`preview.open`](https://vitejs.dev/config/preview-options.html#preview-open).

## [generate]

```toml title="cedar.toml"
[generate]
  tests = true
  stories = true
```

Many of Cedar's generators create Jest tests or Storybook stories.
Understandably, this can be lot of files, and sometimes you don't want all of them, either because you don't plan on using Jest or Storybook, or are just getting started and don't want the overhead.
These options allows you to disable the generation of test and story files.

## [cli]

```toml title="cedar.toml"
[notifications]
  versionUpdates = ["latest"]
```

There are new versions of the framework all the time—a major every couple months, a minor every week or two, and patches when appropriate.
And if you're on an experimental release line, like canary, there's new versions every day, multiple times.

If you'd like to get notified (at most, once a day) when there's a new version, set `versionUpdates` to include the version tags you're interested in.

## Using Environment Variables in `cedar.toml`

You may find yourself wanting to change keys in `cedar.toml` based on the environment you're deploying to.
For example, you may want to point to a different `apiUrl` in your staging environment.

You can do so with environment variables.
Let's look at an example:

```toml title="cedar.toml"
[web]
  // highlight-start
  title = "App running on ${APP_TITLE}"
  port = "${PORT:8910}"
  apiUrl = "${API_URL:/.api/functions}"
  // highlight-end
  includeEnvironmentVariables = []
```

This `${<envVar>:[fallback]}` syntax does the following:

- sets `title` by interpolating the env var `APP_TITLE`
- sets `port` to the env var `PORT`, falling back to `8910`
- sets `apiUrl` to the env var `API_URL`, falling back to `/.api/functions` (the default)

That's pretty much all there is to it.
Just remember two things:

1. fallback is always a string
2. these values are interpolated at build time

## Running in a Container or VM

The web and api servers both default to `host = '::'`, which binds dual-stack
(IPv4 and IPv6) on hosts that support it — no configuration needed to accept
connections from outside the container.

If you need to pin to IPv4 only, set `host` explicitly:

```toml title="cedar.toml"
[web]
  host = '0.0.0.0'
[api]
  host = '0.0.0.0'
```

You can also configure these values via `CEDAR_WEB_HOST` and `CEDAR_API_HOST`.

### Container hosts

Most container hosts (Railway, Render, Fly.io, Cloud Run, Heroku) tell your app
what to bind to with the `HOST` and `PORT` env vars. Cedar reads both, so you
usually don't have to configure anything.

`PORT` is only used by the side serving public traffic. When you run both sides
together with `yarn cedar serve`, that's the web server — the api server keeps
its own port, because the two would otherwise try to bind the same one. Serving
a single side with `yarn cedar serve api` or `yarn cedar serve web` makes that
side the public one.

The full order of precedence is:

1. CLI flags (`--port`, `--host`, `--api-port`, …)
2. `CEDAR_API_PORT` / `CEDAR_WEB_PORT` (and the `_HOST` equivalents)
3. `PORT` / `HOST`, for the public side only
4. `[api].port` / `[web].port` in `cedar.toml`
