---
description: Self-host Cedar on Coolify, with the recommended two-service topology
---

# Deploy to Coolify

[Coolify](https://coolify.io) is a self-hosted alternative to
Heroku/Railway-style PaaS platforms — you run it on your own server(s) and it
manages builds and deploys for you. It's the best fit on the
[any container host](./any-container-host.md) list for anyone self-hosting: it's
free, open source, and — uniquely among the platforms Cedar documents — its
build packs can natively express the
[recommended two-service topology](./introduction.md#two-topologies-and-which-to-pick)
instead of forcing single-container.

## Single-service (start here)

1. Create a new Coolify application from your Cedar repo.
2. Leave the build pack on its default (Nixpacks or Railpack). Coolify finds
   `build` and `start` in `package.json` and runs them with no configuration.
3. Add a Postgres database from Coolify's resource catalog, and set
   `DATABASE_URL` on the application to point at it.
4. Deploy.

This runs the
[single-container topology](./introduction.md#two-topologies-and-which-to-pick)
— the fastest way to get a working deploy.

## Migrations

Coolify doesn't have a dedicated pre-deploy hook the way Railway does. Run
migrations as part of your build command, or as a one-off command against the
running container:

```shell
yarn cedar prisma migrate deploy
```

## Scaling up: two services, the Coolify way

This is what sets Coolify apart from the other platforms on the
[any container host](./any-container-host.md) list: alongside Nixpacks/Railpack,
Coolify also has a **Static** build pack. That means you can express Cedar's
recommended topology — static `web/dist` served separately from a Node api
process — as two Coolify resources instead of one, without reaching for a
Dockerfile:

1. **api service** — Nixpacks/Railpack build pack, start command
   `yarn start:api`.
2. **web service** — Static build pack, pointed at `web/dist` after running
   `yarn build`. Coolify serves it directly rather than running a Node process
   for it.

Wire the web service's api proxy target (`apiUrl` in `cedar.toml`, or
`--apiProxyTarget`) at the api service's Coolify-provided domain.

This is the one platform in this doc set where the recommended topology doesn't
cost you anything extra to set up — no reverse proxy or nginx config to write,
since Coolify's Static build pack already does that job.
