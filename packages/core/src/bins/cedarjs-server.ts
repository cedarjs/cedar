#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromApiServer = createRequire(
  require.resolve('@cedarjs/api-server/package.json'),
)

const bins = requireFromApiServer('./package.json')['bin']

requireFromApiServer(bins['cedarjs-server'])
