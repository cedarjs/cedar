## .cedar/

Cedar apps now default to a top level `.cedar/` directory for generated types,
GraphQL schema, and other transitory data

With both a `cedar.toml` file and a `.cedar/` directory it should be much more
clear to those working on the app that it's a Cedar app and nothing else.
