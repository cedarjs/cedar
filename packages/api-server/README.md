# CedarJS [Fastify](https://www.fastify.io) Server

## About

This package contains code for CedarJS's Fastify server:

- used during local dev for API Side
- used for Production Deploys requiring long-running process (i.e. not
  serverless)

## package.json Server Binaries

Run the CedarJS Fastify Server programmatically.

From package.json

```
  "bin": {
    "cedarjs-api-server-watch": "./dist/watch.js",
    "cedarjs-log-formatter": "./dist/logFormatter/bin.js",
    "cedarjs-server": "./dist/bin.js",
  },
```

> Note: because we use Yargs to parse in index, using these within the context
> of a CedarJS CLI command will throw due to Yargs object "collision". Needs to
> be re-architected in the future.

### `cedarjs-server`

Indended for dev and prototyping (i.e. pre-production).

This command runs both the API and Web server on the same port and is not
performant at scale for production use. Instead, use the separate commands to
run the API and (if needed) Web servers independently, along with tools like
PM2, Nginx, or Kubernetes, which appropriately handle concurrent requests,
errors, static asset, etc. for production contexts.

- Runs web on redwood.toml web.port (default 8910)
- API listens on web port at path redwood.toml web.apiUrl
- Command Options:
  - port (default 8910)
  - socket (optional)
  - apiHost (default redwood.toml web.apiUrl)

### `cedarjs-server api`

For production use.

- Runs api on redwood.toml api.port (default 8911)
- Command Options:
  - port (default 8911)
  - socket (optional)
  - apiRootPath (default '/')

### `cedarjs-server web`

Not optimized for production use at scale (see comments above for
`cedarjs-server`).
Recommended to use CDN or Nginx as performant alternatives.

- Runs web on redwood.toml web.port (default 8910)
- GraphQL endpoint is set to redwood.toml web.apiUrl/graphql
- Command Options:
  - port (default 8910)
  - socket (optional)
  - apiHost (default redwood.toml web.apiUrl)
