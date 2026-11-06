# Rename rollupOptions

Vite bundles with Rolldown, and its `build.rollupOptions`,
`worker.rollupOptions` and `optimizeDeps.rollupOptions` options are deprecated
aliases for `rolldownOptions`.

This codemod renames them to `rolldownOptions` in `web/vite.config.{js,ts}`,
both as object keys and in member expressions like `config.build.rollupOptions`.
Vite treats the two names the same, so the renamed config does exactly what it
did before.

An object that sets both `rollupOptions` and `rolldownOptions` is left as it is.
Vite ignores `rollupOptions` there, so merging the two would change what the
config does. Move anything you still need from `rollupOptions` to
`rolldownOptions` by hand.

Rolldown supports most, but not all, of Rollup's options. See
https://vite.dev/guide/migration for the differences.
