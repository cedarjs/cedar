import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyTsconfigPaths } from '../tsconfig-paths.js'

const FIXTURE_DIR = path.join(__dirname, '__fixtures__/tsconfig-paths')
const IMPORTER_FILE = path.join(FIXTURE_DIR, 'src/functions/nested/nested.ts')

const NO_PATHS_FIXTURE_DIR = path.join(
  __dirname,
  '__fixtures__/tsconfig-paths-no-paths',
)

describe('applyTsconfigPaths', () => {
  it('rewrites a bare specifier that matches a custom tsconfig paths alias', () => {
    const code = `import { widget } from '$widgets/Widget'`
    const result = applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)
    expect(result).toBe(`import { widget } from '../../lib/Widget/Widget'`)
  })

  it('handles double-quoted imports', () => {
    const code = `import { widget } from "$widgets/Widget"`
    const result = applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)
    expect(result).toBe(`import { widget } from "../../lib/Widget/Widget"`)
  })

  it('rewrites a matching re-export', () => {
    const code = `export { widget } from '$widgets/Widget'`
    const result = applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)
    expect(result).toBe(`export { widget } from '../../lib/Widget/Widget'`)
  })

  it('leaves relative imports untouched', () => {
    const code = `import { db } from './db'`
    expect(applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)).toBe(code)
  })

  it('leaves bare package imports untouched', () => {
    const code = `import { gql } from 'graphql-tag'`
    expect(applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)).toBe(code)
  })

  it('leaves imports that do not match any configured alias untouched', () => {
    const code = `import { thing } from '$nonexistent/Thing'`
    expect(applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)).toBe(code)
  })

  it('leaves the excluded src/ alias untouched (handled by applySrcAlias)', () => {
    const code = `import { logger } from 'src/lib/logger'`
    expect(applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)).toBe(code)
  })

  it('leaves the excluded $api/ alias untouched (web-only)', () => {
    const code = `import { db } from '$api/src/lib/db'`
    expect(applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)).toBe(code)
  })

  it('leaves the excluded @cedarjs/* packages untouched', () => {
    const code = `import { context } from '@cedarjs/context'`
    expect(applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)).toBe(code)
  })

  it('returns code unchanged when no custom paths are configured', () => {
    const code = `import { widget } from '$widgets/Widget'`
    expect(applyTsconfigPaths(code, IMPORTER_FILE, NO_PATHS_FIXTURE_DIR)).toBe(
      code,
    )
  })

  it('resolves an alias pointing at a directory-named module (e.g. $services/todos)', () => {
    const code = `import { widget } from '$lib/Widget'`
    const result = applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)
    expect(result).toBe(`import { widget } from '../../lib/Widget/Widget'`)
  })

  it('prefers an index file over a directory-named module when resolving via an alias', () => {
    const code = `import { indexed } from '$lib/IndexedDir'`
    const result = applyTsconfigPaths(code, IMPORTER_FILE, FIXTURE_DIR)
    expect(result).toBe(`import { indexed } from '../../lib/IndexedDir/index'`)
  })
})
