---
description: How to switch from RedwoodJS/RedwoodGraphQL to CedarJS
---

# Migrating from RedwoodJS to CedarJS

The latest version of Cedar that's fully compatible with RedwoodJS is CedarJS
v1.x. Newer versions of Cedar, like v2, have breaking changes compared to RW.
Please migrate to Cedar v1 first, and make sure that's working, before migrating
to v2 or newer.

## Required Steps

1. Search and replace all instances of `"@redwoodjs/(.*)": "\d+\.\d+\.\d+"`
   with `"@cedarjs/$1": "1.1.1"` in all three `package.json` files.
2. Run `yarn install` to update your lock file.
3. Make a git commit with all changes as a checkpoint to make it easier to see
   what changes in the following steps
4. Search and replace all instances of `@redwoodjs` in all files with
   `@cedarjs`.
5. Also find all mentions of `storybook-framework-redwoodjs-vite` and replace
   with `storybook-framework-cedarjs`
6. Pay attention to `yarn.lock`. If anything changed in there you probably have
   to do some manual editing. (Reach out on
   [Discord](https://cedarjs.com/discord) if you need help.)
7. Delete all files and folders inside `.redwood/` except `README.md`
8. Run `yarn install` and `yarn cedar build`. Make sure everything works as
   expected.
9. Make a new git commit (or amend the previous one you did)

## Optional, but Hightly Recommended, Steps

- Update `web/vite.config.ts` to have `import { cedar } from '@cedarjs/vite'`
  and `plugins: [cedar()],` instead of the older
  `import redwood from '@redwoodjs/vite'` and `plugins: [redwood()],`. (Notice
  that it's now a named import instead of a default import.)
