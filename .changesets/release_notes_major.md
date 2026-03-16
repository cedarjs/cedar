# Prisma v7

Explain that the DB url is configured in two places now. lib/db.ts and
prisma.config.cjs. The config is for the cli.
Need to remove it from `schema.prisma` and add it to the config file. Point to
Prisma docs for this.

Testing potentially works differently. If you just have `DATABASE_URL` in your
prisma.config.cjs file, it will be replaced by `TEST_DATABASE_URL` just like
before. But if you need a specific `directUrl`, you should put that in your
config file, and Cedar will _not_ try to replace that for testing.
Instead of brittle string parsing to try to figure out what environment variable
to replace, Cedar now leaves it up to you to configure the correct url to use
for your database during tests. The recommended approach is to do something like
this:

```js
// prisma.config.cjs
module.exports = {
  url:
    env('NODE_ENV') === 'test'
      ? env('TEST_DIRECT_DATABASE_URL')
      : env('DIRECT_DATABASE_URL'),
}
```

Most projects should be able to just use `url: env('DATABASE_URL')` and rely on
Cedar to replace it with the correct value during tests.

- [ ] Write upgrade script that warns about `directUrl`

# Vite 6

CedarJS now uses Vite 6. This upgrade brings several changes and deprecations.

### Key Changes

- **Default Configuration:** `resolve.conditions` and `ssr.resolve.conditions`
  have new defaults. If you have custom conditions in your `vite.config.ts`,
  ensure they align with Vite 6.
- **Sass API:** Now defaults to the modern API. If you rely on the legacy API,
  you may need to explicitly set `css.preprocessorOptions.sass.api: 'legacy'`.
- **JSON Stringify:** Defaults to `'auto'`. If you previously used
  `json.stringify: true` to disable named exports, set
  `json.namedExports: false` instead.
- **CommonJS:** `strictRequires` is now `true` by default.

### Upgrade Steps for Existing Projects

1. Update `vite` to `6.3.7` in your `package.json`.
2. Update `@rollup/plugin-commonjs` to `v28` (if used).
3. Update `postcss-load-config` to `v6` (if used).
4. Review your `vite.config.ts` for any deprecated options mentioned above.
