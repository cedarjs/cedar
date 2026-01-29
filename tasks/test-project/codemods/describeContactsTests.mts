import type { API, FileInfo } from 'jscodeshift'

export default (file: FileInfo, api: API) => {
  const j = api.jscodeshift
  const root = j(file.source)

  // Insert
  // afterEach(() => {
  //   jest.mocked(console).log.mockRestore?.()
  // })
  // into describe blocks for 'contacts'
  root
    .find(j.CallExpression, { callee: { type: 'Identifier' } })
    .filter((p) => {
      const callee = p.node.callee
      return (
        callee.type === 'Identifier' &&
        (callee.name === 'describe' || callee.name === 'describeScenario')
      )
    })
    .forEach((path) => {
      const args = path.node.arguments
      const name = args[0]
      const fn = args[1]

      if (name?.type === 'StringLiteral' && name.value === 'contacts') {
        if (
          (fn.type === 'FunctionExpression' ||
            fn.type === 'ArrowFunctionExpression') &&
          fn.body.type === 'BlockStatement'
        ) {
          const mockRestoreCall = j.callExpression(
            j.memberExpression(
              j.memberExpression(
                j.callExpression(
                  j.memberExpression(
                    j.identifier('jest'),
                    j.identifier('mocked'),
                  ),
                  [j.identifier('console')],
                ),
                j.identifier('log'),
              ),
              j.identifier('mockRestore'),
            ),
            [],
          )

          // This adds `?.()`
          mockRestoreCall.optional = true

          const afterEachFn = j.arrowFunctionExpression(
            [],
            j.blockStatement([j.expressionStatement(mockRestoreCall)]),
          )
          const afterEachCall = j.callExpression(j.identifier('afterEach'), [
            afterEachFn,
          ])

          fn.body.body.unshift(j.expressionStatement(afterEachCall))
        }
      }
    })

  // Add `jest.spyOn(console, 'log').mockImplementation(() => {})` to the
  // "creates a contact" test
  root
    .find(j.CallExpression, {
      callee: { type: 'Identifier', name: 'scenario' },
    })
    .forEach((path) => {
      const args = path.node.arguments
      const name = args[0]
      const fn = args[1]

      if (
        name?.type === 'StringLiteral' &&
        name.value === 'creates a contact'
      ) {
        if (
          (fn?.type === 'FunctionExpression' ||
            fn?.type === 'ArrowFunctionExpression') &&
          fn.body.type === 'BlockStatement'
        ) {
          const spyOnCall = j.callExpression(
            j.memberExpression(
              j.callExpression(
                j.memberExpression(j.identifier('jest'), j.identifier('spyOn')),
                [j.identifier('console'), j.stringLiteral('log')],
              ),
              j.identifier('mockImplementation'),
            ),
            [j.arrowFunctionExpression([], j.blockStatement([]))],
          )

          fn.body.body.unshift(j.expressionStatement(spyOnCall))
        }
      }
    })

  let output = root.toSource()
  const spyOnRegex =
    /(jest\.spyOn\(\s*console\s*,\s*['"]log['"]\s*\)\.mockImplementation\(\s*\(\)\s*=>\s*\{\s*\}\s*\)\s*;?\r?\n)(?!\r?\n)/g
  output = output.replace(spyOnRegex, '$1\n')

  return output
}
