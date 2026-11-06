import { describe, expect, it } from 'vitest'

import { extractCssMappingFromManifest } from '../rsc/rscCss.js'

describe('extractCssMappingFromManifest', () => {
  it('collects css from a chunk and its imports in order', () => {
    const manifest = {
      a: { css: ['a.css'], imports: ['b', 'c'] },
      b: { css: ['b.css'], imports: ['c'] },
      c: { css: ['c.css'] },
      d: {},
    }

    const result = extractCssMappingFromManifest(manifest)

    expect(result.get('a')).toEqual(['a.css', 'b.css', 'c.css'])
    expect(result.get('b')).toEqual(['b.css', 'c.css'])
    expect(result.get('c')).toEqual(['c.css'])
    expect(result.get('d')).toEqual([])
  })

  it('terminates on a two-chunk cycle and returns the union for both', () => {
    const manifest = {
      a: { css: ['a.css'], imports: ['b'] },
      b: { css: ['b.css'], imports: ['a'] },
    }

    const result = extractCssMappingFromManifest(manifest)

    expect(result.get('a')).toEqual(['a.css', 'b.css'])
    expect(result.get('b')).toEqual(['b.css', 'a.css'])
  })

  it('terminates on a self-import', () => {
    const manifest = { a: { css: ['a.css'], imports: ['a'] } }

    const result = extractCssMappingFromManifest(manifest)

    expect(result.get('a')).toEqual(['a.css'])
  })

  it('ignores imports that are missing from the manifest', () => {
    const manifest = { a: { css: ['a.css'], imports: ['missing'] } }

    const result = extractCssMappingFromManifest(manifest)

    expect(result.get('a')).toEqual(['a.css'])
  })
})
