import type { ReactNode } from 'react'

import { expect, test } from 'tstyche'

import { PrivateSet, Set } from '@cedarjs/router'
import type { WrapperProps } from '@cedarjs/router'

function MainLayout({ children }: WrapperProps) {
  return <main>{children}</main>
}

test('WrapperProps is the wrapped routes as children', () => {
  expect<WrapperProps>().type.toBe<{ children: ReactNode }>()
})

test('a layout typed with WrapperProps can be used in wrap', () => {
  expect(<Set wrap={MainLayout}>{null}</Set>).type.not.toRaiseError()
  expect(
    <PrivateSet wrap={MainLayout} unauthenticated="login">
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()
  expect(
    <Set wrap={[MainLayout, MainLayout]}>{null}</Set>,
  ).type.not.toRaiseError()
})
