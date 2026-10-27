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
      // (ObjectProperty is what the TS parser gives, Property the others)
      const idProp = node.properties.find(
        (prop) =>
          (prop.type === 'Property' || prop.type === 'ObjectProperty') &&
          prop.key.type === 'Identifier' &&
          prop.key.name === 'id',
      )

      if (idProp) {
        idProp.value = j.stringLiteral('4c3d3e8e-2b1a-4f5c-8c7d-000000000042')
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
