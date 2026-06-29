#!/usr/bin/env node
import { startUnifiedDevServer } from '../dist/cedar-unified-dev.js'

startUnifiedDevServer().catch((err) => {
  console.error('Failed to start unified dev server:', err)
  process.exit(1)
})
