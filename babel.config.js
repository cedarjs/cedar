// Babel config for the framework repo. `@babel/eslint-parser` reads it (see
// eslint.config.mjs) when ESLint parses the repo's `.js`, `.jsx`, `.cjs` and
// `.mjs` files, and nx.json lists it as a cache input. Framework packages are
// built with esbuild and tsc via `@cedarjs/framework-tools`, so no transforms
// are configured here: the parser only needs to understand the syntax in those
// files, and the syntax it does not support out of the box (JSX) is enabled
// through `parserOptions.ecmaFeatures` in eslint.config.mjs. `.ts` and `.tsx`
// files are parsed by typescript-eslint. Babel configs for user projects live
// in `packages/babel-config`.

/** @type {import('@babel/core').TransformOptions} */
module.exports = {}
