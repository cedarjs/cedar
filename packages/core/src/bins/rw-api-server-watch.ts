#!/usr/bin/env node

import { createRequire } from 'node:module'

const createdRequire = createRequire(import.meta.url)
const { startWatch } = createdRequire('@cedarjs/api-server/watch')

await startWatch()
