import fs from 'node:fs'
import path from 'node:path'

/**
 * Matches a relative import/export/require specifier that carries a TypeScript
 * file extension, e.g. `from './db.ts'`, `import('./db.mts')`,
 * `require('../lib/db.cts')`.
 */
const TS_SPECIFIER_RE =
  /\b(from\s*|import\s*\(\s*|require\s*\(\s*)(['"])(\.\.?\/[^'"]*?\.(?:m|c)?tsx?)\2/g

/**
 * The api build (esbuild with `bundle: false`, and the Rollup equivalent)
 * compiles every source file to `.js`, but leaves import specifiers alone. A
 * source file that imports another source file *by its TypeScript extension* —
 * `import { db } from './db.ts'` — therefore ends up in `api/dist` requiring a
 * file that no longer exists, and the api crashes on boot with
 * `Cannot find module './db.ts'`.
 *
 * `.ts` specifiers are not exotic: the app template's `api/tsconfig.json` sets
 * `allowImportingTsExtensions`, and Prisma's `prisma-client` generator emits
 * them throughout its output when the schema sets
 * `importFileExtension = "ts"` — so an api that generates its client into
 * `api/src` gets a `dist` full of them.
 *
 * This rewrites those specifiers to `.js`, the extension the build actually
 * emits. It is the counterpart of `applyEsmExtensions`, which appends `.js` to
 * *extensionless* relative specifiers for ESM projects; this one runs for both
 * module formats, since CommonJS output is just as unable to resolve a `.ts`
 * specifier.
 *
 * Only specifiers whose source file is actually on disk are rewritten, so a
 * relative import of a genuine `.ts` *asset* is left alone.
 *
 * It is a plain function called inline — not an esbuild plugin — following the
 * same pattern as `applySrcAlias`, `applyEsmExtensions`, etc.
 */
export function applyTsExtensions(code: string, fromFile: string): string {
  const fromDir = path.dirname(fromFile)

  return code.replace(
    TS_SPECIFIER_RE,
    (match, keyword: string, quote: string, importPath: string) => {
      if (!fs.existsSync(path.join(fromDir, importPath))) {
        return match
      }

      const ext = path.extname(importPath)
      const rewritten = importPath.slice(0, -ext.length) + '.js'

      return `${keyword}${quote}${rewritten}${quote}`
    },
  )
}

/**
 * Fail-loud backstop for {@link applyTsExtensions}: walks the built api and
 * throws if any relative `.ts` specifier survived into the output.
 *
 * A surviving specifier is not a cosmetic problem — the api cannot boot with
 * one, so a build that produced one has failed even though every individual
 * step succeeded. Better to say so here than to hand the user a `dist` that
 * only fails when they try to run it.
 */
export async function assertNoTsSpecifiers(distDir: string): Promise<void> {
  let entries: fs.Dirent[]

  try {
    entries = await fs.promises.readdir(distDir, {
      recursive: true,
      withFileTypes: true,
    })
  } catch {
    return
  }

  const offenders: string[] = []

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
      .map(async (entry) => {
        const filePath = path.join(
          (entry as any).parentPath ?? (entry as any).path,
          entry.name,
        )
        const contents = await fs.promises.readFile(filePath, 'utf8')

        for (const match of contents.matchAll(TS_SPECIFIER_RE)) {
          offenders.push(`${path.relative(distDir, filePath)}: ${match[3]}`)
        }
      }),
  )

  if (offenders.length) {
    throw new Error(
      'The api build emitted import specifiers that point at TypeScript ' +
        'files, which do not exist in the build output. The api would crash ' +
        'on boot with "Cannot find module". Offending specifiers:\n' +
        offenders.map((offender) => `  - ${offender}`).join('\n'),
    )
  }
}
