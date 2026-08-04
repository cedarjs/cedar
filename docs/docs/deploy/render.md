---
description: Serverful deploys via Render's unified cloud
---

# Deploy to Render

Render is a unified cloud to build and run all your apps and websites with free SSL, a global CDN, private networks and auto-deploys from Git — **database included**!

## Render tl;dr Deploy

If you simply want to experience the Render deployment process, including a Postgres or SQLite database, you can do the following:

1. create a new Cedar project: `yarn create cedar-app ./render-deploy`
2. after your "render-deploy" project installation is complete, init git, commit, and add it as a new repo to GitHub or GitLab
3. run the command `yarn cedar setup deploy render`, use the flag `--database` to select from `postgresql`, `sqlite` or `none` to proceed without a database [default : `postgresql`]
4. commit the generated `render.yaml`, then create a new Blueprint from your repo at https://dashboard.render.com/iacs
5. after the first deploy, replace the `destination` placeholder in `render.yaml`'s rewrite rule with your api service's URL
