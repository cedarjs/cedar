import type { API, FileInfo } from 'jscodeshift'

export default (file: FileInfo, api: API) => {
  const j = api.jscodeshift
  const root = j(file.source)

  const validateImport = j.importDeclaration(
    [
      j.importSpecifier(
        j.identifier('validateEmail'),
        j.identifier('validateEmail'),
      ),
    ],
    j.stringLiteral('@my-org/validators'),
  )

  // Add `import { validateEmail } from '@my-org/validators'` to the top of the
  // file
  root.get().node.program.body.unshift(validateImport)

  // Insert this if-statment at the top of the `createContact` service function
  // if (!validateEmail(input.email)) {
  //   throw new Error('Invalid email')
  // } else {
  //   console.log('Creating contact with email:', input.email)
  // }
  root
    .find(j.VariableDeclarator, {
      id: { type: 'Identifier', name: 'createContact' },
    })
    .forEach((path) => {
      const init = path.node.init
      if (
        init?.type === 'ArrowFunctionExpression' &&
        init?.body?.type === 'BlockStatement'
      ) {
        const body = init.body

        const test = j.unaryExpression(
          '!',
          j.callExpression(j.identifier('validateEmail'), [
            j.memberExpression(j.identifier('input'), j.identifier('email')),
          ]),
        )

        const ifBody = j.blockStatement([
          j.throwStatement(
            j.newExpression(j.identifier('Error'), [
              j.stringLiteral('Invalid email'),
            ]),
          ),
        ])

        const elseBody = j.blockStatement([
          j.expressionStatement(
            j.callExpression(
              j.memberExpression(j.identifier('console'), j.identifier('log')),
              [
                j.stringLiteral('Creating contact with email'),
                j.memberExpression(
                  j.identifier('input'),
                  j.identifier('email'),
                ),
              ],
            ),
          ),
        ])

        const ifStatement = j.ifStatement(test, ifBody, elseBody)

        // Insert the validation at the top of the function body
        body.body.unshift(ifStatement)
      }
    })

  return root.toSource()
}
