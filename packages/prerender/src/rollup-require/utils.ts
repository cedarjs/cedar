import fs from 'node:fs'
import path from 'node:path'

/** Match .mjs, .cts, .ts, .jsx etc */
export const JS_EXT_RE = /\.([mc]?[tj]s|[tj]sx)$/

export type RequireFunction = (
  outfile: string,
  ctx: { format: 'cjs' | 'esm' },
) => any

function getPkgType() {
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

export function guessFormat(inputFile: string): 'esm' | 'cjs' {
  const ext = path.extname(inputFile)
  const type = getPkgType()
  if (ext === '.js') {
    return type === 'module' ? 'esm' : 'cjs'
  } else if (ext === '.ts' || ext === '.mts') {
    return 'esm'
  } else if (ext === '.mjs') {
    return 'esm'
  }
  return 'cjs'
}

export const getRandomId = () => {
  return Math.random().toString(36).substring(2, 15)
}

export function isValidJsFile(filepath: string) {
  return JS_EXT_RE.test(filepath)
}
