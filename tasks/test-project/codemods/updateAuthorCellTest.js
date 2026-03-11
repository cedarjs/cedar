/**
 * This codemod updates a test like this:
 *
 * import { render } from '@cedarjs/testing/web'
 *
 * import { Loading, Empty, Failure, Success } from './AuthorCell'
 * import { standard } from './AuthorCell.mock'
 *
 * // Generated boilerplate tests do not account for all circumstances
 * // and can fail without adjustments, e.g. Float and DateTime types.
 * //           Please refer to the RedwoodJS Testing Docs:
 * //        https://cedarjs.com/docs/testing#testing-cells
 * // https://cedarjs.com/docs/testing#jest-expect-type-considerations
 *
 * describe('AuthorCell', () => {
 *   it('renders Loading successfully', () => {
 *     expect(() => {
 *       render(<Loading />)
 *     }).not.toThrow()
 *   })
 *
 *   it('renders Empty successfully', async () => {
 *     expect(() => {
 *       render(<Empty />)
 *     }).not.toThrow()
 *   })
 *
 *   it('renders Failure successfully', async () => {
 *     expect(() => {
 *       render(<Failure id={42} error={new Error('Oh no')} />)
 *     }).not.toThrow()
 *   })
 *
 *   // When you're ready to test the actual output of your component render
 *   // you could test that, for example, certain text is present:
 *   //
 *   // 1. import { screen } from '@cedarjs/testing/web'
 *   // 2. Add test: expect(screen.getByText('Hello, world')).toBeInTheDocument()
 *
 *   it('renders Success successfully', async () => {
 *     expect(() => {
 *       render(<Success id={42} author={standard().author} />)
 *     }).not.toThrow()
 *   })
 * })
 *
 * to change the ids from numbers to strings
 */
export default (file, api) => {
  const j = api.jscodeshift
  const root = j(file.source)

  const componentsToUpdate = ['Failure', 'Success']

  root.find(j.JSXOpeningElement).forEach((path) => {
    if (
      path.node.name.type === 'JSXIdentifier' &&
      componentsToUpdate.includes(path.node.name.name)
    ) {
      j(path)
        .find(j.JSXAttribute, {
          name: {
            name: 'id',
          },
        })
        .forEach((attrPath) => {
          const attr = attrPath.node
          if (
            attr.value &&
            attr.value.type === 'JSXExpressionContainer' &&
            attr.value.expression.type === 'NumericLiteral' &&
            attr.value.expression.value === 42
          ) {
            attr.value.expression = j.stringLiteral(
              '4c3d3e8e-2b1a-4f5c-8c7d-000000000042',
            )
          }
        })
    }
  })

  return root.toSource()
}
