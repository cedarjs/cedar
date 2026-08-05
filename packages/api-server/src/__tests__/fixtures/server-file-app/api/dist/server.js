// A minimal stand-in for a project's custom `api/dist/server.js`, used to
// test `runApiDistServerFile`'s dispatch. It does not start a real server —
// a real one runs forever, which would hang the test.
//
// ESM, because the nearest package.json Node resolves module type from is
// this workspace's own (`packages/api-server/package.json`, "type": "module"),
// not a project's — this fixture doesn't represent a real project's module
// format, only the dispatch mechanism.

import fs from 'node:fs'

const argsFile = process.env.TEST_SERVER_FILE_ARGS_FILE

if (argsFile) {
  fs.writeFileSync(argsFile, JSON.stringify(process.argv.slice(2)))
}

const exitCode = process.env.TEST_SERVER_FILE_EXIT_CODE

process.exit(exitCode ? Number(exitCode) : 0)
