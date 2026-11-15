export default (file, api) => {
  const j = api.jscodeshift
  const root = j(file.source)

  // `BlogPost` takes the `blogPost` field of `FindBlogPostQuery`, which is
  // required (and nullable). Change `<BlogPost />` to
  // `<BlogPost blogPost={null} />`
  root
    .find(j.JSXOpeningElement, { name: { name: 'BlogPost' } })
    .replaceWith((nodePath) => {
      const { node } = nodePath
      node.attributes.push(
        j.jsxAttribute(
          j.jsxIdentifier('blogPost'),
          j.jsxExpressionContainer(j.literal(null)),
        ),
      )

      return node
    })

  return root.toSource()
}
