export default (file, api) => {
  const j = api.jscodeshift
  const root = j(file.source)

  root
    .find(j.ArrowFunctionExpression)
    .find(j.ObjectExpression)
    .forEach(({ node, name }) => {
      // Skip the top level object
      if (name === 'body') {
        return
      }

      // Update id to be a string
      const idProp = node.properties.find(
        (prop) =>
          prop.type === 'Property' &&
          prop.key.type === 'Identifier' &&
          prop.key.name === 'id',
      )
      if (
        idProp &&
        idProp.type === 'Property' &&
        idProp.value.type === 'Literal'
      ) {
        idProp.value.value = '4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d'
      }

      node.properties.push(
        j.property('init', j.identifier('email'), j.literal('fortytwo@42.com')),
      )
      node.properties.push(
        j.property('init', j.identifier('fullName'), j.literal('Forty Two')),
      )
    })

  // Update the __typename values
  root
    .find(j.ObjectProperty, {
      key: {
        type: 'Identifier',
        name: '__typename',
      },
    })
    .forEach(({ node }) => {
      if (
        node.value.type === 'TSAsExpression' &&
        node.value.expression.type === 'StringLiteral' &&
        node.value.expression.value === 'author'
      ) {
        node.value.expression.value = 'User'
      }
    })

  return root.toSource()
}
