export default (file, api) => {
  const j = api.jscodeshift
  const root = j(file.source)
  const mockFunction = root.find(j.ArrowFunctionExpression)

  mockFunction.find(j.ObjectExpression).forEach(({ node, name }) => {
    // Skip the top level object
    if (name === 'body') {
      return
    }

    const author = j.objectPattern([
      j.property(
        'init',
        j.identifier('__typename'),
        j.tsAsExpression(
          j.stringLiteral('User'),
          j.tsTypeReference(j.identifier('const')),
        ),
      ),
      j.property('init', j.identifier('email'), j.literal('five@5.com')),
      j.property('init', j.identifier('fullName'), j.literal('Five Lastname')),
    ])

    node.properties.push(
      j.property('init', j.identifier('title'), j.literal('Mocked title')),
    )
    node.properties.push(
      j.property('init', j.identifier('body'), j.literal('Mocked body')),
    )
    node.properties.push(
      j.property(
        'init',
        j.identifier('createdAt'),
        j.literal('2022-01-17T13:57:51.607Z'),
      ),
    )

    // Update authorId if it exists, otherwise push it
    const authorIdProp = node.properties.find(
      (prop) =>
        prop.type === 'Property' &&
        prop.key.type === 'Identifier' &&
        prop.key.name === 'authorId',
    )
    if (
      authorIdProp &&
      authorIdProp.type === 'Property' &&
      authorIdProp.value.type === 'Literal'
    ) {
      authorIdProp.value.value = '005d3e8e-2b1a-4f5c-8c7d-000000000005'
    } else {
      node.properties.push(
        j.property(
          'init',
          j.identifier('authorId'),
          j.literal('005d3e8e-2b1a-4f5c-8c7d-000000000005'),
        ),
      )
    }

    node.properties.push(j.property('init', j.identifier('author'), author))
  })

  // Update the __typename value from 'author' to 'User'
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
        (node.value.expression.value === 'blogPost' ||
          node.value.expression.value === 'blogPosts')
      ) {
        node.value.expression.value = 'Post'
      }
    })

  return root.toSource()
}
