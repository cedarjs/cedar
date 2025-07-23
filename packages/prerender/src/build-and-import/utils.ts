import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Match .mjs, .cts, .ts, .jsx etc */
export const JS_EXT_RE = /\.([mc]?[tj]s|[tj]sx)$/

export type RequireFunction = (
  outfile: string,
  ctx: { format: 'cjs' | 'esm' },
) => any

export function getPkgType() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf-8'),
    )

    return pkg.type
  } catch {
    // Ignore
  }

  return undefined
}

export const getRandomId = () => {
  return Math.random().toString(36).substring(2, 15)
}

export function isValidJsFile(filepath: string) {
  return JS_EXT_RE.test(filepath)
}

import type { OutputChunk } from 'rollup'

export function setPrerenderChunkIds(
  code: string,
  dynamicImports: OutputChunk['dynamicImports'],
) {
  if (!code.includes('__PRERENDER_CHUNK_ID.js')) {
    return code
  }

  // const ContactContactPage = {
  //     name: "ContactContactPage",
  //     prerenderLoader: (name)=>require('./ContactPage-__PRERENDER_CHUNK_ID.js'),
  //     LazyComponent: /*#__PURE__*/ React.lazy(()=>Promise.resolve().then(function () { return require('./ContactPage-pvUUt2sr.js'); }))
  // };
  // const AboutPage = {
  //     name: "AboutPage",
  //     prerenderLoader: (name)=>require('./AboutPage-__PRERENDER_CHUNK_ID.js'),
  //     LazyComponent: /*#__PURE__*/ React.lazy(()=>Promise.resolve().then(function () { return require('./AboutPage-pvUUt2sr.js'); }))
  // };
  const newCode = code.replace(
    /'\.\/([^']+Page-)__PRERENDER_CHUNK_ID\.js'/g,
    (_match, pageName) => {
      const chunkName = dynamicImports.find((importedChunk) =>
        importedChunk.startsWith(pageName),
      )
      return `'./${chunkName}'`
    },
  )

  return newCode
}

/**
 * Converts a file path to a URL path (file://...)
 * Without this, absolute paths can't be imported on Windows
 */
export function makeFilePath(path: string) {
  return pathToFileURL(path).href
}
