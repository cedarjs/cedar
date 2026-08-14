---
description: Serverful deploys via Render's unified cloud
---

# Deploy to Render

Render is a unified cloud to build and run all your apps and websites with free
SSL, a global CDN, private networks and auto-deploys from Git, **including
databases**!

## Render tl;dr Deploy

If you simply want to experience the Render deployment process, including a
Postgres or SQLite database, you can do the following:

1. create a new Cedar project: `yarn create cedar-app ./render-deploy`
2. after your "render-deploy" project installation is complete, init git,
   commit, and add it as a new repo to GitHub or GitLab
3. run the command `yarn cedar setup deploy render`, use the flag `--database`
   to select from `postgresql`, `sqlite` or `none` to proceed without a database
   [default : `postgresql`]
4. commit the generated `render.yaml`, then create a new Blueprint from your
   repo at https://dashboard.render.com/iacs
5. after the first deploy, replace the `destination` placeholder in
   `render.yaml`'s rewrite rule with your api service's URL, then **commit and
   push** it.

For a more detailed walkthrough, see
[Render's Deploying Redwood guide](https://render.com/docs/deploy-redwood). It
predates the Cedar fork and uses `rw` naming throughout, but it's still the most
thorough deploy walkthrough available for this setup. Everywhere it says
`yarn rw`, use `yarn cedar` instead, and the rest applies as written.

## Database Migrations

The generated `render.yaml` runs `prisma migrate deploy` as part of the api
service's `startCommand` (`yarn cedar deploy render api`, see
`renderHandler.ts`), right before the server starts accepting traffic. That's
intentional, and not a stand-in for a missing feature: Render has a native
[pre-deploy command](https://render.com/docs/deploys#pre-deploy-command)
(`preDeployCommand` in the Blueprint spec) for exactly this kind of task, but
it has two limitations that rule it out as the default here:

- **Paid instances only** — the pre-deploy command isn't available on Render's
  free plan, but Cedar's generated `api` service defaults to `plan: free`
  (see the tl;dr walkthrough above).
- **No persistent disk access** — it "executes on a separate instance from
  your running service" and can't reach an attached persistent disk, so it
  couldn't run migrations against the `sqlite` deploy option's database file,
  which lives on one.

If you're on a paid plan and using Postgres (i.e. not the `sqlite` deploy
option), you can switch to `preDeployCommand` instead: move the
`prisma migrate deploy` call out of `startCommand` and into a
`preDeployCommand` entry on the `api` service in `render.yaml`.
