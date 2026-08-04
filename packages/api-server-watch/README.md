# @cedarjs/api-server-watch

The `cedar dev` file watcher for the api side: rebuilds and restarts the api
server when its source changes.

Split out of `@cedarjs/api-server` so that package can stay free of
`@cedarjs/internal` (the build/codegen toolchain) in production installs.
This package only ever runs under `cedar dev`, where that toolchain is
already present as part of the CLI, so it declares `@cedarjs/internal` as a
regular dependency.

## Command

```shell
cedar-api-server-watch
```

Also installed as `cedarjs-api-server-watch`. Both names are what
`yarn cedar dev` shells out to; you shouldn't normally need to run this
directly.
