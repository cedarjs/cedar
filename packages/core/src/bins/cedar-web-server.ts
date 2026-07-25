#!/usr/bin/env node
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const webServerPackageJsonPath =
  require.resolve('@cedarjs/web-server/package.json')
const webServerPackageJson = require(webServerPackageJsonPath)

const bins = webServerPackageJson['bin']
const binPath = path.join(
  path.dirname(webServerPackageJsonPath),
  bins['cedar-web-server'],
)

await import(pathToFileURL(binPath).href)
