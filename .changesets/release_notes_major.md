## RWJS_DELAY_RESTART removed

The `RWJS_DELAY_RESTART` environment variable has been removed. It was renamed
to `CEDAR_DELAY_API_RESTART` in a previous release. If you still have
`RWJS_DELAY_RESTART` in your `.env` file, rename it to `CEDAR_DELAY_API_RESTART`.

## cedar-gen

Public:
rw-gen -> cedar-gen

Internal:
REDWOOD_ENV_FILES_LOADED -> CEDAR_ENV_FILES_LOADED

## .cedar/

This isn't breaking, but I wanted to call it out anyway, and recommend you
update your own projects too

Cedar apps now default to a top level `.cedar/` directory for generated types,
GraphQL schema, and other transitory data

With both a `cedar.toml` file and a `.cedar/` directory it should be much more
clear to those working on the app that it's a Cedar app and nothing else.
