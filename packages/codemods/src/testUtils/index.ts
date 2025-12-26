import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { format } from 'prettier'
import parserBabel from 'prettier/parser-babel'

export const formatCode = async (code: string) => {
  return format(code, {
    parser: 'babel-ts',
    plugins: [parserBabel],
  })
}

export const createProjectMock = () => {
  const tempDir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'cedar-test-'),
  )

  // add fake redwood.toml
  fs.closeSync(fs.openSync(path.join(tempDir, 'redwood.toml'), 'w'))

  return tempDir
}
