---
description: If you have to configure Vite, here's how
---

# Vite Configuration

Cedar uses Vite. One of Cedar's tenets is convention over configuration.

Vite is an awesome build tool, but we don't want it to be something that you
have to be familiar with to be productive. So it's worth repeating that you
don't have to do any of this, because we configure everything you will need out
of the box with a Cedar Vite plugin.

Regardless, there'll probably come a time when you have to configure Vite. All
the Vite configuration for your web side sits in `web/vite.config.{js,ts}`, and
can be configured the same as any other Vite project. Let's take a peek!

```ts
import dns from 'node:dns'

import { defineConfig } from 'vite'

import { cedar } from '@cedarjs/vite'

// So that Vite will load on localhost instead of `127.0.0.1`.
// See: https://vite.dev/config/server-options.html#server-host
dns.setDefaultResultOrder('verbatim')

export default defineConfig(({ mode }) => ({
  plugins: [
    // 👇 this is the CedarJS Vite plugin, that houses all the default
    // configuration
    cedar({ mode }),
    // ... add any custom Vite plugins you would like here
  ],
  // You can override built in configuration like server, optimizeDeps, etc.
  // here
}))
```

Checkout Vite's docs on [configuration](https://vite.dev/config/)

### Custom Babel plugins

Vite doesn't run your code through Babel, so `web/babel.config.js` is not
applied to your dev server or production bundle. If you need a custom Babel
plugin or preset in your web build, pass it via the `cedar()` plugin's `babel`
option:

```ts
export default defineConfig(({ mode }) => ({
  plugins: [cedar({ mode, babel: { plugins: ['my-babel-plugin'] } })],
}))
```

## One plugin — or all the building blocks

For almost every project, the single `cedar()` plugin is all you'll ever
need: one line that pulls in all of Cedar's Vite configuration. But `cedar()`
is itself composed of many small plugins, and each of Cedar's own building
blocks is individually exported. So when you really do need full control, like
dropping one of Cedar's plugins, reordering them, or wedging your own plugin
in between two of them, you can skip `cedar()` and compose the pipeline
yourself.

Most of the pipeline comes straight from `@cedarjs/vite`:

```ts
import {
  cedarCellTransform,
  cedarDataUriShim,
  cedarEntryInjectionPlugin,
  cedarHtmlEnvPlugin,
  cedarMergedConfig,
  cedarRoutesAutoLoaderPlugin,
  // ... and many more
} from '@cedarjs/vite'
```

But `cedar()` isn't built from `@cedarjs/vite` exports alone. It also includes
other plugins, and a custom pipeline needs to include those too (or make a
deliberate decision to leave them out).

The [`cedar()` implementation](https://github.com/cedarjs/cedar/blob/main/packages/vite/src/index.ts)
is the authoritative list of everything it's made of and the order it all runs
in. It's a good starting point for your own customizations.

A word of warning: if you compose your own pipeline, you own it. Cedar releases
can add, rename, remove, or reorder plugins (especially across major versions),
so check the release notes when you upgrade.

### Sass and Tailwind CSS

Vite has built-in support for Sass, all you have to do is add the package:

```
yarn workspace web add -D sass
```

And if you want to use Tailwind CSS, just run the setup command:

```
yarn cedar setup ui tailwindcss
```

> Note: The setup command `yarn cedar setup ui tailwindcss` installs Tailwind
> CSS v3.x by default. Cedar also works with Tailwind v4.x, but the setup
> helper does not currently install that version or its configuration.

## Vite Dev Server

Cedar uses Vite's dev server for local development. When you run
`yarn cedar dev`, keys in your `cedar.toml`'s `[web]` table—like `port` and
`apiUrl`—are used as Vite dev server options (in this case,
[server.port](https://vite.dev/config/server-options.html#server-port) and
[server.proxy](https://vite.dev/config/server-options.html#server-proxy)
respectively).

> You can peek at all the out-of-the-box configuration for your Vite dev
> server in the
> [CedarJS Vite plugin](https://github.com/cedarjs/cedar/blob/main/packages/vite/src/index.ts)

### Using `--forward`

While you can configure Vite using `web/vite.config.js`, it's often simpler to
use `yarn cedar dev`'s `--forward` option.

For example, if you want to force optimise your Vite dependencies again, you
can run:

```
yarn cedar dev --fwd="--force"
```

You can also use `--forward` to override keys in your `cedar.toml`. For
example, the following starts your app on port `1234` and disables automatic
browser opening:

```
yarn cedar dev --forward="--port=1234 --open=false"
```
