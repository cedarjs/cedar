import path from 'node:path'

import { rollup } from 'rollup'
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

import type * as ProjectConfig from '@cedarjs/project-config'

import { cedarjsPrerenderMediaImportsPlugin } from '../rollup-plugin-cedarjs-prerender-media-imports.js'

let mockDistDir: string
let mockSrcDir: string

vi.mock('@cedarjs/project-config', async () => {
  const actual = await vi.importActual<typeof ProjectConfig>(
    '@cedarjs/project-config',
  )
  return {
    ...actual,
    getPaths: () => ({
      web: {
        dist: mockDistDir,
        src: mockSrcDir,
      },
    }),
    ensurePosixPath: (p: string) => p.replace(/\\/g, '/'),
  }
})

vi.mock('../utils', () => ({
  convertToDataUrl: (assetPath: string) =>
    `data:image/jpg;base64,xxx-mock-b64-${path.basename(assetPath)}`,
}))

function makeInput(code: string) {
  return {
    input: 'entry.js',
    plugins: [
      {
        name: 'virtual-entry',
        resolveId(id: string) {
          if (id === 'entry.js') {
            return id
          }
          return null
        },
        load(id: string) {
          if (id === 'entry.js') {
            return code
          }
          return null
        },
      },
      cedarjsPrerenderMediaImportsPlugin(),
    ],
    onwarn: () => {},
  }
}

describe('cedarjsPrerenderMediaImportsPlugin', () => {
  beforeEach(() => {
    mockDistDir = path.resolve(__dirname, './__fixtures__/viteDistDir')
    mockSrcDir = path.resolve(__dirname, './__fixtures__/viteSrcDir')
    vi.clearAllMocks()
  })

  it('replaces imports with manifest asset paths', async () => {
    const bundle = await rollup(
      makeInput(`
          import img1 from './components/Post/Posts/image1.jpg';
        import img2 from './pages/HomePage/image2.jpeg';
        import img3 from './pages/HomePage/image3.png';
        import img4 from './pages/HomePage/image4.bmp';
        import pdfDoc from './pdf/invoice.pdf';
        import nyanCat from './pages/HomePage/funny.gif';
        console.log(img1, img2, img3, img4, pdfDoc, nyanCat);
      `),
    )
    const { output } = await bundle.generate({ format: 'esm' })
    const code = output[0].code

    expect(code).toContain('assets/image1-hash.jpg')
    expect(code).toContain('assets/image2-hash.jpeg')
    expect(code).toContain('assets/image3-hash.png')
    expect(code).toContain('assets/image4-hash.bmp')
    expect(code).toContain('assets/invoice-7d64ed28.pdf')
    expect(code).toContain('assets/funny-hash.gif')
  })

  it('replaces imports not in manifest with data URLs', async () => {
    const bundle = await rollup(
      makeInput(`
        import img1 from './pages/HomePage/small.jpg';
        console.log(img1);
      `),
    )
    const { output } = await bundle.generate({ format: 'esm' })
    const code = output[0].code

    expect(code).toContain('data:image/jpg;base64,xxx-mock-b64-small.jpg')
  })

  it('respects custom extensions option', async () => {
    const customPlugin = cedarjsPrerenderMediaImportsPlugin({
      extensions: ['.png'], // Only PNG files
    })

    const bundle = await rollup({
      input: 'entry.js',
      plugins: [
        {
          name: 'virtual-entry',
          resolveId(id: string) {
            if (id === 'entry.js') {
              return id
            }
            return null
          },
          load(id: string) {
            if (id === 'entry.js') {
              return `
                import pngImg from './pages/HomePage/image3.png';
                console.log(pngImg);
              `
            }
            return null
          },
        },
        customPlugin,
      ],
      onwarn: () => {},
    })

    const { output } = await bundle.generate({ format: 'esm' })
    const code = output[0].code

    // Should transform .png files when included in custom extensions
    expect(code).toContain('assets/image3-hash.png')
  })

  afterAll(() => {
    vi.clearAllMocks()
  })
})
