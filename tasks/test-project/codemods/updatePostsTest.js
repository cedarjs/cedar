export default (file, api) => {
  const j = api.jscodeshift
  const root = j(file.source)

  // Update createPost input
  root
    .find(j.CallExpression, {
      callee: { name: 'createPost' },
    })
    .find(j.ObjectProperty, { key: { name: 'authorId' } })
    .forEach((path) => {
      path.node.value = j.memberExpression(
        j.memberExpression(
          j.memberExpression(j.identifier('scenario'), j.identifier('post')),
          j.identifier('two'),
        ),
        j.identifier('authorId'),
      )
    })

  // Update expect(result.authorId).toEqual(...)
  root
    .find(j.CallExpression, {
      callee: { property: { name: 'toEqual' } },
    })
    .filter((path) => {
      const expectCall = path.node.callee.object
      return (
        expectCall.type === 'CallExpression' &&
        expectCall.callee.name === 'expect' &&
        expectCall.arguments.length > 0 &&
        expectCall.arguments[0].type === 'MemberExpression' &&
        expectCall.arguments[0].property.name === 'authorId'
      )
    })
    .forEach((path) => {
      path.node.arguments[0] = j.memberExpression(
        j.memberExpression(
          j.memberExpression(j.identifier('scenario'), j.identifier('post')),
          j.identifier('two'),
        ),
        j.identifier('authorId'),
      )
    })

  return root.toSource()
}
