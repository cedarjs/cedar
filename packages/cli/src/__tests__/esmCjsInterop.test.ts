/**
 * Guards against named imports from external CJS packages that would throw
 * at runtime in the built CLI.
 *
 * The CLI is built by esbuild in transpile-only mode (no bundling), so import
 * statements survive unchanged into `dist/` and are resolved by Node.js's
 * native ESM loader at runtime.  When a CJS package's exports can't be
 * statically detected by `cjs-module-lexer`, Node.js throws at module-load
 * time:
 *
 *   SyntaxError: Named export 'X' not found. The requested module 'Y'
 *   is a CommonJS module, which may not support all module.exports as
 *   named exports.
 *
 * The fix for CJS packages is always to use a default import and destructure:
 *   import pkg from 'cjs-package'
 *   const { namedExport } = pkg
 *
 * WHY WE SPAWN A SUBPROCESS
 * ─────────────────────────
 * Vitest runs under Vite, which wraps every CJS module so that all of its
 * `module.exports` properties are available as named exports.  That's the
 * opposite of what Node.js's native ESM loader does, so a plain
 * `await import(pkg)` inside a vitest test silently masks the exact bug
 * we want to catch.  We therefore spawn a vanilla
 * `node --input-type=module` process whose module resolution is identical
 * to the one the built CLI uses at runtime.
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'

import { parse as babelParse } from '@babel/parser'
import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

// ── Types ──────────────────────────────────────────────────────────────────

type NamedImportRef = {
  /** Path relative to srcDir, for readable error messages. */
  file: string
  /** The original exported name (before any `as` alias). */
  specifier: string
}

type ProbeEntry = {
  pkg: string
  /** True when the package threw during import (native addons, etc.). */
  skipped?: boolean
  /** Specifier names that are absent from the module namespace. */
  missing?: string[]
}

// ── 1. Collect named imports from every CLI source file ───────────────────
//
// Runs at module-evaluation time via top-level await so the Map is fully
// populated before describe() is called.

const srcDir = path.resolve(import.meta.dirname, '..')

const namedImportsByPkg = new Map<string, NamedImportRef[]>()

const sourceFiles = await fg(['**/*.{ts,js}'], {
  cwd: srcDir,
  absolute: true,
  ignore: [
    '**/__tests__/**',
    '**/*.test.*',
    '**/__fixtures__/**',
    '**/__testfixtures__/**',
    '**/__typetests__/**',
    '**/testUtils/**',
  ],
})

for (const file of sourceFiles) {
  let content: string
  try {
    content = fs.readFileSync(file, 'utf-8')
  } catch {
    continue
  }

  let ast: ReturnType<typeof babelParse>
  try {
    ast = babelParse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      // errorRecovery keeps us going on files with exotic syntax instead of
      // silently dropping them from the scan.
      errorRecovery: true,
    })
  } catch {
    continue
  }

  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') {
      continue
    }

    // `import type { … }` has no runtime presence — skip entirely.
    if ((node as any).importKind === 'type') {
      continue
    }

    const source: string = node.source.value

    // We only care about third-party packages:
    //   • skip relative imports
    //   • skip Node.js built-ins (with or without the `node:` prefix)
    //   • skip sibling workspace packages (always ESM)
    if (source.startsWith('.')) {
      continue
    }
    if (isBuiltin(source)) {
      continue
    }
    if (source.startsWith('@cedarjs/')) {
      continue
    }

    const namedSpecifiers: string[] = (node.specifiers as any[])
      .filter(
        (s) =>
          s.type === 'ImportSpecifier' &&
          // Skip individual type-only specifiers: `import { type Foo, bar }`
          s.importKind !== 'type',
      )
      .map((s) =>
        // `imported` is Identifier or StringLiteral
        // (e.g. `import { 'exotic-name' as local } from 'pkg'`)
        s.imported.type === 'StringLiteral'
          ? s.imported.value
          : s.imported.name,
      )

    if (namedSpecifiers.length === 0) {
      continue
    }

    const existing = namedImportsByPkg.get(source) ?? []
    for (const specifier of namedSpecifiers) {
      existing.push({ file: path.relative(srcDir, file), specifier })
    }
    namedImportsByPkg.set(source, existing)
  }
}

// ── 2. Probe every package with a real Node.js ESM process ────────────────
//
// We build a single self-contained script that dynamic-imports each package
// and records which names are missing from the namespace, then spawn it once.
// One spawn keeps total overhead low regardless of how many packages there are.

const probeScript = `
  async function probe(pkg, names) {
    let m
    try {
      m = await import(pkg)
    } catch {
      return { pkg, skipped: true }
    }
    return { pkg, missing: names.filter((n) => !(n in m)) }
  }

  const results = await Promise.all([
  ${[...namedImportsByPkg.entries()]
    .map(([pkg, refs]) => {
      const names = JSON.stringify([...new Set(refs.map((r) => r.specifier))])
      return `  probe(${JSON.stringify(pkg)}, ${names})`
    })
    .join(',\n')}
  ])

  process.stdout.write(JSON.stringify(results))
`

const spawnResult = spawnSync(
  process.execPath,
  ['--input-type=module', '-e', probeScript],
  {
    // Resolve from the package root so Node.js can find node_modules.
    cwd: path.resolve(srcDir, '..'),
    encoding: 'utf-8',
    timeout: 30_000,
  },
)

let probeData: ProbeEntry[] = []
if (spawnResult.error || spawnResult.status !== 0) {
  // Only fail hard if we actually had packages to probe; an empty
  // namedImportsByPkg means there's genuinely nothing to check.
  if (namedImportsByPkg.size > 0) {
    const msg =
      spawnResult.stderr ?? spawnResult.error?.message ?? '(no output)'
    throw new Error(`ESM probe subprocess failed:\n${msg}`)
  }
} else if (spawnResult.stdout) {
  try {
    probeData = JSON.parse(spawnResult.stdout) as ProbeEntry[]
  } catch {
    // JSON parse failed — fail-open: tests below will pass vacuously.
    // The raw stderr from the subprocess will surface separately.
  }
}

const probeMap = new Map(probeData.map((e) => [e.pkg, e]))

// ── 3. Assert ──────────────────────────────────────────────────────────────

describe('Named imports from external packages resolve in Node.js ESM context', () => {
  for (const [pkg, refs] of namedImportsByPkg) {
    it(`'${pkg}'`, () => {
      const entry = probeMap.get(pkg)

      if (!entry || entry.skipped) {
        // The package couldn't be imported in the probe process (missing
        // native addon, requires a Cedar project on disk, etc.).
        // Skip rather than emit a noisy false-positive.
        return
      }

      if (!entry.missing || entry.missing.length === 0) {
        return
      }

      const details = entry.missing.map((s) => {
        const ref = refs.find((r) => r.specifier === s)
        return ref ? `  '${s}'  (imported in ${ref.file})` : `  '${s}'`
      })

      const localName = pkg.replace(/[^a-zA-Z0-9]/g, '')

      expect.fail(
        [
          `The following named imports from '${pkg}' are not exposed by`,
          `Node.js's native ESM loader (cjs-module-lexer could not detect them):`,
          ``,
          ...details,
          ``,
          `If '${pkg}' is a CJS module, use a default import and destructure instead:`,
          `  import ${localName} from '${pkg}'`,
          `  const { ${entry.missing.join(', ')} } = ${localName}`,
        ].join('\n'),
      )
    })
  }
})
