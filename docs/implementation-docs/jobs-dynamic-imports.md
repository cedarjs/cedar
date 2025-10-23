Supporting dynamic imports like `const mod = await import('src/lib/module.js')`
in jobs.

With CedarJS v0.14.0 dynamic imports in jobs broke. Jobs are executed by a node
process that's running jobs/src/bin/rw-jobs-worker.ts. rw-jobs-worker, if you
follow the code deep enough, uses jobs/src/loaders.ts to `await import` the
user-defined job and runs it. It loads from `getPaths().api.distJobs`, i.e. the
built version of the job.
So, basically, when running jobs we're just using plain Node, passing in a .js
file. This tells me that it's our regular build process that's responsible for
the bug that broke dynamic imports.

Cedar v0.14.0 was the same version that I released the work I had done on
[api-side extensionless imports](./api-extensionless-imports.md). So I guessed
it was related.

In `getApiSideBabelPlugins()` (as mentioned in that file above), we remove .js
file extensions to let babel figure out what file to actually import. We can't
do that for dynamic imports though, because they always need the file extension
when Node is running the file.
Keeping it around, however, breaks data migrations with an error like this:

```
Error: Cannot find module './logger.js'
Require stack:
- /Users/tobbe/tmp/cedar-0140-jobs/api/src/lib/db.ts
- /Users/tobbe/tmp/cedar-0140-jobs/node_modules/@cedarjs/cli-data-migrate/dist/commands/upHandler.js
```

And the reason is that it's actually a .ts file.

Found an old comment in git history that confirms this

// If the .js file doesn't exist but the .ts file does, remove
// the extension and let babel figure out what file to import.
// Have to do this because I was having problems with imports
// like `import { logger } from './logger.js'` in data-migrate
// scripts in CJS projects

Here's a good example to test with, to make sure both regular and dynamic
imports work:

```ts
import type { PrismaClient } from '@prisma/client'

import { libLog } from './lib/lib.js'

export default async ({ db: _ }: { db: PrismaClient }) => {
  libLog('test')

  const { libLog: asyncLibLog } = await import('./lib/lib.js')
  asyncLibLog('test')
}
```

For data-migrate we can actually treat regular and dynamic imports the same way
and the reason for that is that data migrations are executed within the full
Cedar CLI environment that has babel's require hook loaded. So, in contrast to
jobs, which are using node to run built files, data migrations use babel to do
the TS transformation and it also takes care of module resolutions, allowing it
to run source files directly.

CedarJS currently have a few different places where code transformation happens:

- build
- dev
- data-migrate
- jobs
- exec
- prerender

Only data-migrate and prerender uses babel to execute source files directly. And
they only do so for CJS projects. As soon as we move to ESM only, all of this
will be much simpler

prerender executes routeHooks, but it does so using `exec`, and that's not using
babel's require hook (it's using vite-node). But prerender _also_ dynamically
imports the user's graphql handler. And this is done with babel (in CJS
projects). So we need to have the same behavior as for data-migrate.
