import fs from 'node:fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

// Vitest 4's module runner no longer provides the CJS `__dirname` shim in ES
// module scope, so use `import.meta.dirname` instead
const distPath = path.join(import.meta.dirname, 'dist')
const packageConfig = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))

describe('dist', () => {
  it("shouldn't have the __tests__ directory", () => {
    expect(fs.existsSync(path.join(distPath, '__tests__'))).toEqual(false)
  })

  it('ships the expected bins', () => {
    expect(packageConfig.bin).toMatchInlineSnapshot(`
      {
        "cedar-api-server-watch": "./dist/watch.js",
        "cedarjs-api-server-watch": "./dist/watch.js",
      }
    `)
  })
})
