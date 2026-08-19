import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fixSourceMaps } from '../build/api.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cedar-sourcemaps-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeMap(relPath: string, sources: string[]) {
  const absPath = path.join(tmpDir, relPath)
  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  fs.writeFileSync(
    absPath,
    JSON.stringify({ version: 3, sources, mappings: '' }),
  )
}

function readMapSources(relPath: string): string[] {
  const absPath = path.join(tmpDir, relPath)
  return JSON.parse(fs.readFileSync(absPath, 'utf8')).sources
}

function touchFile(relPath: string) {
  const absPath = path.join(tmpDir, relPath)
  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  fs.writeFileSync(absPath, '')
}

describe('fixSourceMaps', () => {
  it('rewrites wrong sources path to correct relative path', async () => {
    const distDir = path.join(tmpDir, 'dist')
    const srcDir = path.join(tmpDir, 'src')

    writeMap('dist/functions/graphql.js.map', ['/absolute/wrong/path.ts'])
    touchFile('src/functions/graphql.ts')

    await fixSourceMaps(distDir, srcDir)

    expect(readMapSources('dist/functions/graphql.js.map')).toEqual([
      '../../src/functions/graphql.ts',
    ])
  })

  it('leaves an already-correct path untouched', async () => {
    const distDir = path.join(tmpDir, 'dist')
    const srcDir = path.join(tmpDir, 'src')

    writeMap('dist/functions/graphql.js.map', [
      '../../src/functions/graphql.ts',
    ])
    touchFile('src/functions/graphql.ts')

    const before = fs.statSync(
      path.join(tmpDir, 'dist/functions/graphql.js.map'),
    ).mtimeMs

    await fixSourceMaps(distDir, srcDir)

    const after = fs.statSync(
      path.join(tmpDir, 'dist/functions/graphql.js.map'),
    ).mtimeMs

    expect(before).toBe(after) // file was not rewritten
  })

  it('handles nested paths correctly', async () => {
    const distDir = path.join(tmpDir, 'dist')
    const srcDir = path.join(tmpDir, 'src')

    writeMap('dist/services/posts/posts.js.map', ['wrong'])
    touchFile('src/services/posts/posts.ts')

    await fixSourceMaps(distDir, srcDir)

    expect(readMapSources('dist/services/posts/posts.js.map')).toEqual([
      '../../../src/services/posts/posts.ts',
    ])
  })

  it('handles .tsx source files', async () => {
    const distDir = path.join(tmpDir, 'dist')
    const srcDir = path.join(tmpDir, 'src')

    writeMap('dist/functions/widget.js.map', ['wrong'])
    touchFile('src/functions/widget.tsx')

    await fixSourceMaps(distDir, srcDir)

    expect(readMapSources('dist/functions/widget.js.map')).toEqual([
      '../../src/functions/widget.tsx',
    ])
  })

  it('skips map files with no corresponding source file', async () => {
    const distDir = path.join(tmpDir, 'dist')
    const srcDir = path.join(tmpDir, 'src')

    writeMap('dist/functions/generated.js.map', ['wrong'])
    // no source file created

    await fixSourceMaps(distDir, srcDir)

    // sources left unchanged
    expect(readMapSources('dist/functions/generated.js.map')).toEqual(['wrong'])
  })

  it('skips maps with empty sources array', async () => {
    const distDir = path.join(tmpDir, 'dist')
    const srcDir = path.join(tmpDir, 'src')

    writeMap('dist/functions/empty.js.map', [])
    touchFile('src/functions/empty.ts')

    await fixSourceMaps(distDir, srcDir)

    expect(readMapSources('dist/functions/empty.js.map')).toEqual([])
  })

  it('returns early without throwing when distDir does not exist', async () => {
    const distDir = path.join(tmpDir, 'nonexistent-dist')
    const srcDir = path.join(tmpDir, 'src')

    await expect(fixSourceMaps(distDir, srcDir)).resolves.toBeUndefined()
  })
})
