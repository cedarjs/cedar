Supporting aliased extensionless imports like `import { db } from 'src/lib/db'`
and `import { logger } from 'src/lib/logger'`.

First step was setting the correct tsconfig options:

```js
  "module": "preserve",
  "moduleResolution": "bundler",
```

Next step was to decide if I wanted to fix `dev` or `build` first. I decided to
go with `dev`. `yarn cedarjs dev` is handled by
`packages/cli/src/commands/devHandler.js`, which in turn calls
`cedarjs-api-server-watch` for ESM projects. `cedarjs-api-server-watch` is the
name I've given `packages/api-server/src/watch.ts` when it's built for ESM. (The
same file built for CJS is referenced by the name `rw-api-server-watch`.)

api-server's `watch.ts` calls out to `packages/internal/src/build/api.ts` to
do the actual (re-)building of the api side. It uses esbuild + babel to
transpile the code.

At this point, when I'm in `packages/internal/src/build/api.ts`, I'm working
with code that used for both `dev` and `build`. So whatever changes I make here
will fix them both.

To support extensionless imports I need to tell babel how to resolve them.

Babel does this using plugins. The relevant plugins are configured in
`packages/babel-config/src/api.ts` in the `getApiSideBabelPlugins()` function
where we for ESM projects pass in `projectIsEsm: true`.

For the imports the main plugin is `babel-plugin-module-resolver`. Its
`resolvePath` function used to only be invoked for CJS projects, but now I
change things so that it's invoked for both CJS and ESM projects. For ESM
projects we need to make sure it resolves to a path with the correct extension,
matching what the file will get when it's eventually built and written to disk.
To figure out what extension the file will get we check what extension the
source file we're importing has, and append the proper extension based on that.
There is some "guessing" going on here based on heuristics. The path/extension
resolution rules TS and node uses are pretty complex. I've implemented a
simplified version that's good enough for our purposes.
