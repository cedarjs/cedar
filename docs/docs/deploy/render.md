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
   [default : `postgresql`]. Note: `sqlite` stores its database file on a
   persistent disk, which Render's free plan doesn't support — the setup
   command will prompt you to confirm putting the `api` service on a paid
   plan before generating `render.yaml`. With `postgresql` or `none`, the
   `api` service itself stays on the free plan (the managed Postgres database
   that `postgresql` provisions has its own separate plan, set by Render).
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
