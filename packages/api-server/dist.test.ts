import fs from 'node:fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

const distPath = path.join(__dirname, 'dist')
const packageConfig = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))

describe('dist', () => {
  it("shouldn't have the __tests__ directory", () => {
    expect(fs.existsSync(path.join(distPath, '__tests__'))).toEqual(false)
  })

  it('ships the expected bins', () => {
    expect(packageConfig.bin).toMatchInlineSnapshot(`
      {
        "cedar-api-server-watch": "./dist/cjs/watch.js",
        "cedar-log-formatter": "./dist/cjs/logFormatter/bin.js",
        "cedar-server": "./dist/cjs/bin.js",
        "cedarjs-api-server-watch": "./dist/watch.js",
        "cedarjs-log-formatter": "./dist/logFormatter/bin.js",
        "cedarjs-server": "./dist/bin.js",
        "rw-server": "./dist/cjs/bin.js",
      }
    `)
  })
})
