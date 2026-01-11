import { render } from '@cedarjs/testing/web'

import { Loading, Empty, Failure, Success } from './AuthorCell'
import { standard } from './AuthorCell.mock'

// Generated boilerplate tests do not account for all circumstances
// and can fail without adjustments, e.g. Float and DateTime types.
//           Please refer to the RedwoodJS Testing Docs:
//        https://cedarjs.com/docs/testing#testing-cells
// https://cedarjs.com/docs/testing#jest-expect-type-considerations

describe('AuthorCell', () => {
  it('renders Loading successfully', () => {
    expect(() => {
      render(<Loading />)
    }).not.toThrow()
  })

  it('renders Empty successfully', async () => {
    expect(() => {
      render(<Empty />)
    }).not.toThrow()
  })

  it('renders Failure successfully', async () => {
    expect(() => {
      render(<Failure id={'4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d'} error={new Error('Oh no')} />)
    }).not.toThrow()
  })

  // When you're ready to test the actual output of your component render
  // you could test that, for example, certain text is present:
  //
  // 1. import { screen } from '@cedarjs/testing/web'
  // 2. Add test: expect(screen.getByText('Hello, world')).toBeInTheDocument()

  it('renders Success successfully', async () => {
    expect(() => {
      render(<Success id={'4c3d3e8e-2b1a-4f5c-8c7d-9e0f1a2b3c4d'} author={standard().author} />)
    }).not.toThrow()
  })
})
