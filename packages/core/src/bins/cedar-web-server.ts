#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const requireFromWebServer = createRequire(
  require.resolve('@cedarjs/web-server/package.json'),
)

const bins = requireFromWebServer('./package.json')['bin']

requireFromWebServer(bins['cedar-web-server'])
