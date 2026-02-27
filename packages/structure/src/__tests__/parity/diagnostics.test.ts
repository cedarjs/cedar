import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

import { getProject } from '../../index'

describe('Diagnostic Parity', () => {
  const fixtures = [
    'example-todo-main-with-errors',
    'test-project',
    'local:structure-test-project',
  ]

  fixtures.forEach((fixtureName) => {
    it(`captures correct diagnostics for ${fixtureName}`, async () => {
      let projectRoot: string
      if (fixtureName.startsWith('local:')) {
        projectRoot = resolve(
          __dirname,
          '__fixtures__',
          fixtureName.replace('local:', ''),
        )
      } else {
        projectRoot = resolve(
          __dirname,
          '../../../../../__fixtures__',
          fixtureName,
        )
      }

      const project = getProject(projectRoot)
      const diagnostics = await project.collectDiagnostics()

      const cleanDiagnostics = diagnostics
        .map((d) => ({
          message: d.diagnostic.message,
          severity: d.diagnostic.severity,
          start: {
            line: d.diagnostic.range.start.line,
            character: d.diagnostic.range.start.character,
          },
          end: {
            line: d.diagnostic.range.end.line,
            character: d.diagnostic.range.end.character,
          },
          uri: d.uri.replace(projectRoot, ''),
        }))
        .sort((a, b) => {
          const uriComp = a.uri.localeCompare(b.uri)
          if (uriComp !== 0) {
            return uriComp
          }
          return a.message.localeCompare(b.message)
        })

      expect(cleanDiagnostics).toMatchSnapshot()
    })
  })
})
