#!/usr/bin/env node

// A proxy for running the "redwood" @cedarjs/cli bin (`yarn redwood`, or
// `yarn rw`) from @cedarjs/core.
//
// createRequire is for ES modules. require literally doesn't exist in ES
// modules, so if you want to use it, you have to create it.
//
// But that's not why we're using it here. We're using it here to require files
// from other packages for yarn 3 reasons:
//
// > If your package is something that automatically loads plugins (for example
// > eslint), peer dependencies obviously aren't an option as you can't
// > reasonably list all plugins. Instead, you should use the createRequire
// > function to load plugins on behalf of the configuration file that lists the
// > plugins to load, be it the package.json or a custom one like the
// > .eslintrc.js file.
//
// See:
// - https://yarnpkg.com/advanced/rulebook#packages-should-only-ever-require-what-they-formally-list-in-their-dependencies
// - https://yarnpkg.com/advanced/rulebook#modules-shouldnt-hardcode-node_modules-paths-to-access-other-modules

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// You can think about the argument we're passing to `createRequire` as being
// kinda like setting the `cwd`:
//
// > It's using the path/URL to resolve relative paths (e.g.:
// > createRequire('/foo/bar')('./baz') may load /foo/bar/baz/index.js)
//
// Example import.meta.url value:
// file:///Users/tobbe/tmp/rx-create-app/node_modules/@cedarjs/core/dist/bins/redwood.js
//
// See https://github.com/nodejs/node/issues/40567#issuecomment-949825461.
const require = createRequire(import.meta.url)

// Example value:
// file:///Users/tobbe/tmp/rx-create-app/node_modules/@cedarjs/cli/package.json
const cliPackageJsonFileUrl = pathToFileURL(
  require.resolve('@cedarjs/cli/package.json'),
)

const requireFromCli = createRequire(cliPackageJsonFileUrl)
const bins = requireFromCli('./package.json')['bin']
const cliEntryPointUrl = new URL(bins['cedarjs'], cliPackageJsonFileUrl)

import(cliEntryPointUrl.toString())
