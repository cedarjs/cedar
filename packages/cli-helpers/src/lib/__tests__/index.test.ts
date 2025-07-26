import path from 'path'

import { beforeAll, afterAll, vi, test, expect } from 'vitest'

import { prettify } from '../index.js'

vi.mock('../paths', () => {
  return {
    getPaths: () => {
      return {
        base: path.resolve(
          __dirname,
          '../../../../../__fixtures__/test-project',
        ),
      }
    },
  }
})

const RWJS_CWD = process.env.RWJS_CWD

beforeAll(() => {
  process.env.RWJS_CWD = path.resolve(
    __dirname,
    '../../../../../__fixtures__/test-project',
  )
})

afterAll(() => {
  process.env.RWJS_CWD = RWJS_CWD
})

test('prettify formats tsx content', async () => {
  const content = `import React from 'react'

  interface Props { foo: number, bar: number }

  const FooBarComponent: React.FC<Props> = ({ foo, bar }) => {
    if (foo % 3 === 0 && bar % 5 === 0) {
      return <>FooBar</>
    }

    if (foo % 3 === 0 || bar % 3 === 0) {
      return <>Foo</>;
    }

    if (foo % 5 === 0 || bar % 5 === 0) { return <>Bar</>}

    return <>{foo}, {bar}</>}`

  // The test project we're pointing to during this test uses tailwind, so for
  // this `expect` to pass, we need to have prettier-plugin-tailwindcss
  // installed. That's why it's a dev dependency for this package
  expect(
    await prettify('FooBarComponent.template.tsx', content),
  ).toMatchSnapshot()
})
