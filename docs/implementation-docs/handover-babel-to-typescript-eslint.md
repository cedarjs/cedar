# Handover: Migrate ESLint Config from Babel to @typescript-eslint/parser

## Context

We are in the process of removing Babel from the CedarJS framework entirely. This
document covers the first and most self-contained step of that migration: replacing
`@babel/eslint-parser` with `@typescript-eslint/parser` in the ESLint configuration.

This is a good starting point because:

- It is self-contained — no other packages need to change for this step to be complete
- It removes `@cedarjs/babel-config` as a dependency of `packages/eslint-config`, which
  is one of the early milestones toward eventually retiring the `babel-config` package
- The risk is low — if something goes wrong it only affects linting, not the build or runtime
- `@typescript-eslint/parser` is already installed and already used for TypeScript files
  in both configs (see the `tseslint` usage in `shared.mjs` and `eslint.config.mjs`)

## Files to Change

There are two parallel ESLint configs to update. One is a legacy CJS config
(`shared.js` + `index.js`) and one is the modern flat config (`shared.mjs` +
`index.mjs`). Both need the same treatment. There is also the framework's own root-level
config (`eslint.config.mjs`) which needs updating independently.

### 1. `packages/eslint-config/shared.mjs` (flat config, project-facing)

**Current state:**

- Imports `babelParser` from `@babel/eslint-parser`
- Imports `babelPlugin` from `@babel/eslint-plugin`
- Sets `parser: babelParser` as the base parser for all files
- Registers `'@babel': babelPlugin` in plugins
- A separate block for config files (`.babelrc.js`, `babel.config.js`, etc.) also
  uses `parser: babelParser`

**What to do:**

- Remove the `@babel/eslint-parser` and `@babel/eslint-plugin` imports
- The `@typescript-eslint/parser` is already used for `.ts`/`.tsx` files via
  `tseslint.configs.base`. For `.js`/`.jsx` files you can either:
  - Use `@typescript-eslint/parser` directly (it handles JSX and modern JS just fine
    without a `tsconfig.json` when `project` is not set), or
  - Use the `espree` parser (ESLint's built-in default) which is sufficient for plain JS
  - The recommended approach is `@typescript-eslint/parser` for consistency, since it is
    already a dependency
- Remove the `'@babel': babelPlugin` plugin registration and any rules prefixed with
  `@babel/` (check for any `'@babel/...'` rule keys in the `rules` object — there do not
  appear to be any currently, but verify)
- Remove `eslint-plugin-babel` from the plugins list and its associated rules (the
  `shared.js` CJS version lists it; check for `'babel/...'` rule keys)
- The config file block that currently sets `parser: babelParser` for
  `.babelrc.js` / `babel.config.js` etc. should be updated to use the default parser
  or `@typescript-eslint/parser`. Once Babel is fully removed from the project,
  the entries for `.babelrc.js` and `babel.config.js` in the `files` glob can also
  be removed, but do not remove them yet — leave that for the final Babel cleanup PR.

### 2. `packages/eslint-config/index.mjs` (flat config, project-facing)

**Current state:**

- Imports `getCommonPlugins`, `getApiSideDefaultBabelConfig`,
  `getWebSideDefaultBabelConfig` from `@cedarjs/babel-config`
- Calls those functions to build a `babelOptions` object which is passed into
  `parserOptions.babelOptions` for the `.js`/`.jsx` file block

**What to do:**

- Remove the `@cedarjs/babel-config` import entirely
- Remove the `getProjectBabelOptions()` function and its call site
- Remove the `parserOptions.babelOptions` key from the JS/JSX file config block —
  this is only needed when using `@babel/eslint-parser` and is meaningless to
  `@typescript-eslint/parser`
- The `forJavaScriptLinting` flag in `getWebSideDefaultBabelConfig` was a special
  case to enable `@babel/preset-react` for JS-only projects so the parser could
  understand JSX. This is not needed with `@typescript-eslint/parser`, which
  understands JSX natively via `parserOptions.ecmaFeatures.jsx: true`.

### 3. `packages/eslint-config/shared.js` (legacy CJS config, project-facing)

This is the CJS equivalent of `shared.mjs`. Apply the same changes as above:

- The `parser: '@babel/eslint-parser'` line at the top level should change to
  `parser: '@typescript-eslint/parser'` (or be removed to fall back to espree for
  JS files, while TS files keep their override)
- Remove `'@babel'` and `'babel'` from the `plugins` array
- Remove `eslint-plugin-babel` and `@babel/eslint-plugin` usage

### 4. `packages/eslint-config/index.js` (legacy CJS config, project-facing)

The CJS equivalent of `index.mjs`:

- Remove the `require('@cedarjs/babel-config')` call
- Remove `getProjectBabelOptions()` and the `parserOptions.babelOptions` key
- Same reasoning as `index.mjs` above

### 5. `eslint.config.mjs` (framework root config, not shipped to projects)

**Current state:**

- Imports `babelParser` from `@babel/eslint-parser` and `babelPlugin` from
  `@babel/eslint-plugin`
- Has a `findBabelConfig()` helper that walks up the directory tree to find
  `babel.config.js` and passes it as `babelOptions.configFile` to the parser
- Applies `parser: babelParser` to all `**/*.js`, `**/*.jsx`, `**/*.cjs`,
  `**/*.mjs` files
- Registers `'@babel': babelPlugin` in the shared plugins block

**What to do:**

- Remove the `babelParser` and `babelPlugin` imports
- Remove the `findBabelConfig()` helper function entirely
- For the JS/JSX/CJS/MJS file block, switch to `@typescript-eslint/parser` (already
  imported via `tseslint`) or remove the explicit parser override and let TypeScript
  ESLint's base config handle it
- Remove `'@babel': babelPlugin` from the plugins object
- The config file block that lists `babel.config.js` etc. in its `files` glob —
  same note as above, leave those globs for now and just fix the parser

## Dependency Changes

Once the code changes above are done, the following can be removed from
`packages/eslint-config/package.json`:

```json
"@babel/core": "...",
"@babel/eslint-parser": "...",
"@babel/eslint-plugin": "...",
"@babel/cli": "...",
"@cedarjs/babel-config": "workspace:*",
"eslint-import-resolver-babel-module": "...",
"eslint-plugin-babel": "..."
```

Note: `@babel/core` is a peer dependency of `@babel/eslint-parser`, so it can go too
once the parser is removed.

`eslint-import-resolver-babel-module` is used by `eslint-plugin-import` to resolve
module paths that go through Babel's `module-resolver` plugin (e.g. `src/` aliases).
Once `@babel/eslint-parser` is gone this resolver is no longer invoked. You will need
to verify that `eslint-plugin-import`'s `import/order` rule still resolves `src/`
aliases correctly. The `'import/internal-regex': '^src/'` setting in `shared.mjs`
controls what counts as "internal", and that should continue to work without the Babel
resolver. If module resolution becomes inaccurate you can switch to
`eslint-import-resolver-typescript` which is the idiomatic replacement.

## Verification

After making the changes, run the following to confirm linting still works end-to-end:

```sh
# From the repo root
yarn lint

# Also lint a JS-only Cedar project if you have one available, since the
# forJavaScriptLinting path is being removed
```

Pay particular attention to:

- **JS files** (`.js`, `.jsx`) in both `api/` and `web/` directories of a Cedar project —
  these were previously parsed by `@babel/eslint-parser` and are the most likely to
  surface regressions
- **`import/order` rule** — verify imports are still being sorted and that `src/`
  aliases are still correctly classified as "internal"
- **JSX in `.js` files** — Cedar projects can write JSX in `.js` files (not just
  `.jsx`). Confirm `@typescript-eslint/parser` handles this with
  `parserOptions.ecmaFeatures.jsx: true`, which it does by default

## What This Does NOT Cover

This PR intentionally does not:

- Touch `packages/babel-config` itself
- Change any build pipeline (esbuild, Vite, Rollup)
- Remove `babel.config.js` from the repo root or any package
- Affect prerendering, the CLI `exec`/`console` commands, or code generation
- Change how Cedar projects configure their own Babel setup (user-land `babel.config.js`
  files are still supported for now)

Those are tracked separately as subsequent steps in the broader Babel removal effort.

## Further Reading

- [`@typescript-eslint/parser` docs](https://typescript-eslint.io/packages/parser/)
- [`typescript-eslint` migration guide from `@babel/eslint-parser`](https://typescript-eslint.io/getting-started)
- [`eslint-import-resolver-typescript`](https://github.com/import-js/eslint-import-resolver-typescript)
  as a replacement for `eslint-import-resolver-babel-module`
