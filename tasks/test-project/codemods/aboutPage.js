const body = `(
        <>
          <p className="font-light">
            This site was created to demonstrate my mastery of Cedar: Look on my
            works, ye mighty, and despair!
          </p>
          <p data-testid="fraction-test">Half is {half}</p>
        </>
      )`

export default (file, api) => {
  const j = api.jscodeshift
  const root = j(file.source)

  const fractionImport = j.importDeclaration(
    [j.importSpecifier(j.identifier('Fraction'))],
    j.stringLiteral('fraction.js'),
  )

  // Remove the `{ Link, routes }` imports that are generated and unused
  root
    .find(j.ImportDeclaration, {
      source: {
        type: 'StringLiteral',
        value: '@cedarjs/router',
      },
    })
    .remove()
  // Remove the `{ Metadata }` import that is generated and unused
  root
    .find(j.ImportDeclaration, {
      source: {
        type: 'StringLiteral',
        value: '@cedarjs/web',
      },
    })
    .remove()

  root.find(j.VariableDeclaration).at(0).insertBefore(fractionImport)

  return root
    .find(j.VariableDeclarator, {
      id: {
        type: 'Identifier',
        name: 'AboutPage',
      },
    })
    .replaceWith((nodePath) => {
      const { node } = nodePath
      // Compute `half` before the return statement.
      node.init.body.body.unshift(
        j.variableDeclaration('const', [
          j.variableDeclarator(
            j.identifier('half'),
            j.callExpression(
              j.memberExpression(
                j.newExpression(j.identifier('Fraction'), [
                  j.literal(1),
                  j.literal(2),
                ]),
                j.identifier('toFraction'),
              ),
              [],
            ),
          ),
        ]),
      )
      node.init.body.body[1].argument = body
      return node
    })
    .toSource()
}
