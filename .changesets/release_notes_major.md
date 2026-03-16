# Prisma v7

Explain that the DB url is configured in two places now. lib/db.ts and
prisma.config.cjs. The config is for the cli.
Need to remove it from `schema.prisma` and add it to the config file. Point to
Prisma docs for this.

## SQLite `DATABASE_URL` path change

If your project uses SQLite, update your `DATABASE_URL` from:

- `file:./dev.db`

to:

- `file:./db/dev.db`

This keeps the SQLite database file in `api/db/dev.db`, which is where Cedar's
Prisma 7 setup expects it to live.

In practice, this means updating the value in the env file your project uses,
for example:

```js
DATABASE_URL=file:./db/dev.db
```

If you leave the old value in place, Prisma CLI commands and runtime database
access can end up pointing at different files, which may show up as errors like
"table does not exist" even though the expected tables exist in another SQLite
file.

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
