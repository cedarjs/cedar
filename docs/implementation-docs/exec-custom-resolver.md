I was getting errors like these when running scripts with `exec scriptName`:

```
7:08:58 PM [vite] Pre-transform error: Failed to load url /api/src/lib/db.js (resolved id: /api/src/lib/db.js) in /Users/tobbe/tmp/cedar-0140-jobs/api/src/lib/jobs.ts. Does the file exist?
7:08:58 PM [vite] Pre-transform error: Failed to load url /api/src/lib/logger.js (resolved id: /api/src/lib/logger.js) in /Users/tobbe/tmp/cedar-0140-jobs/api/src/lib/jobs.ts. Does the file exist?
7:08:58 PM [vite] Pre-transform error: Failed to load url /api/src/lib/db.js (resolved id: /api/src/lib/db.js) in /Users/tobbe/tmp/cedar-0140-jobs/api/src/lib/jobs.ts. Does the file exist?
7:08:58 PM [vite] Pre-transform error: Failed to load url /api/src/lib/logger.js (resolved id: /api/src/lib/logger.js) in /Users/tobbe/tmp/cedar-0140-jobs/api/src/lib/jobs.ts. Does the file exist?
```

The issue is with these imports:

```ts
import { db } from 'src/lib/db.js'
import { logger } from 'src/lib/logger.js'
```

In a TypeScript project the name of the source files for those imports are
db.ts and logger.ts

When authoring TypeScript, that's to be transpiled to JavaScript and then run by
Node, using the .js extension is typically what you should do, because that's
what the files to import will be named when Node executes them. But now we're
using vite-node, and vite-node runs the source files, not built files. And so
the extension should be empty, to let vite-node guess the file extension, or .ts
to explicitly tell it.

The solution is to update our custom resolver in packages/cli/src/lib/exec.js to
remove .js imports and let vite figure out the file extension:
