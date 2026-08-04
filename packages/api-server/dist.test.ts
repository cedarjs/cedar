import fs from 'node:fs'
import path from 'path'

import { describe, it, expect } from 'vitest'

const distPath = path.join(import.meta.dirname, 'dist')
const packageConfig = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))

describe('dist', () => {
  it("shouldn't have the __tests__ directory", () => {
    expect(fs.existsSync(path.join(distPath, '__tests__'))).toEqual(false)
  })

  it('ships the expected bins', () => {
    expect(packageConfig.bin).toMatchInlineSnapshot(`
      {
        "cedar-log-formatter": "./dist/logFormatter/bin.js",
        "cedar-server": "./dist/bin.js",
        "cedarjs-log-formatter": "./dist/logFormatter/bin.js",
        "cedarjs-server": "./dist/bin.js",
        "rw-log-formatter": "./dist/logFormatter/bin.js",
        "rw-server": "./dist/bin.js",
      }
    `)
  })
})
