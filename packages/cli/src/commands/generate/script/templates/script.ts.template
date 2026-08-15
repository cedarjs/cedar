// Append api/* to import from api and web/* to import from web

// To access your database uncomment the line below
// import { db } from 'api/src/lib/db'

interface ScriptArgs {
  args: {
    // positional args, e.g. `yarn cedar exec myScript foo 123` -> ['foo', 123]
    // numeric-looking args are parsed as numbers, others as strings
    _: Array<string | number>
    // named flags, e.g. `--force` -> { force: true }
    [flag: string]: unknown
  }
}

export default async ({ args }: ScriptArgs) => {
  // Your script here...
  console.log(':: Executing script with args ::')
  console.log(args)
}
