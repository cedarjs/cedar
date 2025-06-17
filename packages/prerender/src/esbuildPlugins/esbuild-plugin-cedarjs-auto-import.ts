import fs from 'node:fs'

import type { Plugin } from 'esbuild'

interface AutoImportDeclaration {
  default?: string
  members?: string[]
  path: string
}

interface AutoImportOptions {
  declarations: (AutoImportDeclaration | false)[]
}

export function cedarjsAutoImportPlugin(options: AutoImportOptions): Plugin {
  return {
    name: 'cedarjs-auto-import',
    setup(build) {
      // Filter out false declarations
      const declarations = options.declarations.filter(
        Boolean,
      ) as AutoImportDeclaration[]

      build.onLoad({ filter: /\.(js|jsx|ts|tsx)$/ }, async (args) => {
        console.log('auto-import from', args.path)
        const contents = await fs.promises.readFile(args.path, 'utf8')

        // Check if file needs any auto-imports
        let needsTransform = false
        const importsToAdd: string[] = []

        for (const declaration of declarations) {
          if (declaration.default) {
            // Check if the default import is used but not imported
            const defaultImportRegex = new RegExp(
              `\\b${declaration.default}\\b`,
            )
            const hasImportRegex = new RegExp(
              `import\\s+${declaration.default}\\s+from\\s+['"]${declaration.path}['"]`,
            )
            const hasImportAsRegex = new RegExp(
              `import\\s+.*\\s+as\\s+${declaration.default}\\s+.*from\\s+['"]${declaration.path}['"]`,
            )

            if (
              defaultImportRegex.test(contents) &&
              !hasImportRegex.test(contents) &&
              !hasImportAsRegex.test(contents)
            ) {
              importsToAdd.push(
                `import ${declaration.default} from '${declaration.path}'`,
              )
              needsTransform = true
            }
          }

          if (declaration.members && declaration.members.length > 0) {
            // Check if any of the named imports are used but not imported
            const membersToImport: string[] = []

            for (const member of declaration.members) {
              const memberRegex = new RegExp(`\\b${member}\\b`)
              const hasNamedImportRegex = new RegExp(
                `import\\s*\\{[^}]*\\b${member}\\b[^}]*\\}\\s*from\\s*['"]${declaration.path}['"]`,
              )

              if (
                memberRegex.test(contents) &&
                !hasNamedImportRegex.test(contents)
              ) {
                membersToImport.push(member)
                needsTransform = true
              }
            }

            if (membersToImport.length > 0) {
              importsToAdd.push(
                `import { ${membersToImport.join(', ')} } from '${declaration.path}'`,
              )
            }
          }
        }

        if (!needsTransform) {
          return null // No transformation needed
        }

        console.log('importsToAdd to', args.path, importsToAdd)

        // Add imports at the top of the file, after any existing imports
        let transformedContents = contents
        const importLines = importsToAdd.join('\n')

        // Find the position to insert imports
        // Look for existing imports first
        const importRegex = /^import\s+.+$/gm
        const matches = [...contents.matchAll(importRegex)]

        if (matches.length > 0) {
          // Insert after the last import
          const lastImport = matches[matches.length - 1]
          const insertIndex = lastImport.index + lastImport[0].length
          transformedContents =
            contents.slice(0, insertIndex) +
            '\n' +
            importLines +
            contents.slice(insertIndex)
        } else {
          // Insert at the beginning of the file
          transformedContents = importLines + '\n' + contents
        }

        return {
          contents: transformedContents,
          loader:
            args.path.endsWith('.tsx') || args.path.endsWith('.jsx')
              ? 'tsx'
              : 'ts',
        }
      })
    },
  }
}
