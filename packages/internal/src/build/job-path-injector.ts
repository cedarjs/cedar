import path from 'node:path'

import { parseSync } from 'oxc-parser'

/**
 * Injects `path` and `name` properties into `createJob()` definitions so the
 * jobs runner can locate and identify the job's module at runtime.
 *
 * Standalone equivalent of the Vite cedarjsJobPathInjectorPlugin (used by
 * buildApp and apiDevMiddleware) and the Babel pluginRedwoodJobPathInjector
 * override they replaced. Applied inline in the esbuild API build and the
 * standalone-Vite API build so neither path depends on Babel for job path
 * injection.
 *
 * Keep this in sync with
 * packages/vite/src/plugins/vite-plugin-cedarjs-job-path-injector.ts.
 */
export function applyJobPathInjector(
  code: string,
  filePath: string,
  jobsDir: string,
): string | null {
  // Quick check to see if this might be a job file
  if (!code.includes('createJob')) {
    return null
  }

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

  // Collect insertions; they are applied in reverse order below so earlier
  // positions stay valid while splicing
  const insertions: { pos: number; text: string }[] = []

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

      // Only match `<something>.createJob(...)`, mirroring the
      // `$OBJ.createJob({ $$$PROPS })` pattern in the Vite plugin
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

      const pathProperty = `path: ${JSON.stringify(importPathWithoutExtension)}`
      const nameProperty = `name: ${JSON.stringify(declarator.id.name)}`

      const lastProperty = configArg.properties.at(-1)
      if (lastProperty) {
        // Insert right after the last property. This stays valid whether or
        // not the object literal has a trailing comma.
        insertions.push({
          pos: lastProperty.end,
          text: `, ${pathProperty}, ${nameProperty}`,
        })
      } else {
        // Empty object: insert right after the opening brace
        insertions.push({
          pos: configArg.start + 1,
          text: `${pathProperty}, ${nameProperty}`,
        })
      }
    }
  }

  if (insertions.length === 0) {
    return null
  }

  let result = code
  for (const { pos, text } of insertions.sort((a, b) => b.pos - a.pos)) {
    result = result.slice(0, pos) + text + result.slice(pos)
  }

  return result
}
