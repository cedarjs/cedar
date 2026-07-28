import path from 'node:path'

import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'
import { parseSync } from 'oxc-parser'
import type { Plugin } from 'vite'

import { getPaths } from '@cedarjs/project-config'

/**
 * Vite plugin that injects `path` and `name` properties into `createJob()`
 * definitions so the jobs runner can locate and identify the job's module at
 * runtime.
 *
 * Transforms:
 *   export const myJob = jobs.createJob({ perform: ... })
 * into:
 *   export const myJob = jobs.createJob({ perform: ..., path: "...", name: "myJob" })
 *
 * The extraction uses an oxc-parser AST walk so the transform is robust
 * against nested object properties, aliased imports, and TypeScript syntax.
 * The same logic is duplicated in `@cedarjs/internal`
 * (`applyJobPathInjector`) for the standalone esbuild API build.
 */
export function cedarjsJobPathInjectorPlugin(): Plugin {
  return {
    name: 'cedarjs-job-path-injector',
    transform(code, id) {
      // Quick check to see if this might be a job file
      if (!code.includes('createJob')) {
        return null
      }

      const result = applyJobPathInjector(code, id, getPaths().api.jobs)
      if (!result) {
        return null
      }

      return {
        code: result.code,
        map: result.map,
      }
    },
  }
}

/**
 * Injects `path` and `name` properties into `createJob()` definitions.
 * Returns the transformed code with a sourcemap, or null if no
 * transformation was needed.
 *
 * Duplicate of `@cedarjs/internal`'s `applyJobPathInjector` so this logic can
 * run inside the Vite plugin pipeline without depending on internal's build
 * output.
 */
export function applyJobPathInjector(
  code: string,
  filePath: string,
  jobsDir: string,
): { code: string; map: SourceMap } | null {
  let program
  try {
    program = parseSync(filePath, code, { sourceType: 'module' }).program
  } catch (error) {
    console.warn('Failed to parse file:', filePath)
    console.warn(error)

    // If we can't parse, just return the original code
    return null
  }

  const importPath = path.relative(jobsDir, filePath)
  const importPathWithoutExtension = importPath.replace(/\.[^/.]+$/, '')

  const s = new MagicString(code)
  let hasTransformations = false

  for (const node of program.body) {
    if (node.type !== 'ExportNamedDeclaration') {
      continue
    }
    const decl = node.declaration
    if (decl?.type !== 'VariableDeclaration') {
      continue
    }

    // Check every declarator: in
    // `export const a = 1, myJob = jobs.createJob({})` the job is declared
    // on the second one
    for (const declarator of decl.declarations) {
      if (declarator.id.type !== 'Identifier') {
        continue
      }

      const init = declarator.init
      if (init?.type !== 'CallExpression') {
        continue
      }

      // Only match `<something>.createJob(...)`
      const callee = init.callee
      if (
        callee.type !== 'MemberExpression' ||
        callee.computed ||
        callee.property.type !== 'Identifier' ||
        callee.property.name !== 'createJob'
      ) {
        continue
      }

      const configArg = init.arguments[0]
      if (configArg?.type !== 'ObjectExpression') {
        continue
      }

      hasTransformations = true

      const pathProperty = `path: ${JSON.stringify(importPathWithoutExtension)}`
      const nameProperty = `name: ${JSON.stringify(declarator.id.name)}`

      const lastProperty = configArg.properties.at(-1)
      if (lastProperty) {
        // Insert right after the last property. This stays valid whether or
        // not the object literal has a trailing comma.
        s.appendLeft(lastProperty.end, `, ${pathProperty}, ${nameProperty}`)
      } else {
        // Empty object: insert right after the opening brace
        s.appendLeft(configArg.start + 1, `${pathProperty}, ${nameProperty}`)
      }
    }
  }

  if (!hasTransformations) {
    return null
  }

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
  }
}
