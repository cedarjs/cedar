import type { ReactNode } from 'react'

import { expect, test } from 'tstyche'

import { PrivateSet, Set } from '@cedarjs/router'
import type { WrapperProps } from '@cedarjs/router'

function MainLayout({ children }: WrapperProps) {
  return <main>{children}</main>
}

function OptionalPropsLayout({
  children,
  theme,
}: WrapperProps & { theme?: 'light' | 'dark' }) {
  return <div className={theme}>{children}</div>
}

function ScaffoldLayout({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  )
}

test('wrap rejects a component with required extra props', () => {
  expect(<Set wrap={ScaffoldLayout}>{null}</Set>).type.toRaiseError(
    'is not assignable to type',
  )
})

test('wrap accepts a component with optional extra props', () => {
  expect(<Set wrap={OptionalPropsLayout}>{null}</Set>).type.not.toRaiseError()
})

test('wrap rejects elements', () => {
  expect(
    <Set wrap={<ScaffoldLayout title="Posts" />}>{null}</Set>,
  ).type.toRaiseError()
})

test('wrap checks every component in an array', () => {
  expect(
    <Set wrap={[MainLayout, OptionalPropsLayout]}>{null}</Set>,
  ).type.not.toRaiseError()

  expect(
    <Set wrap={[MainLayout, ScaffoldLayout]}>{null}</Set>,
  ).type.toRaiseError()
})

test('Set rejects props meant for its wrappers', () => {
  expect(
    <Set wrap={MainLayout} theme="dark">
      {null}
    </Set>,
  ).type.toRaiseError("Property 'theme' does not exist")
})

test('PrivateSet has the same wrap contract as Set', () => {
  expect(
    <PrivateSet unauthenticated="login" wrap={ScaffoldLayout}>
      {null}
    </PrivateSet>,
  ).type.toRaiseError('is not assignable to type')

  expect(
    <PrivateSet unauthenticated="login" wrap={MainLayout} theme="dark">
      {null}
    </PrivateSet>,
  ).type.toRaiseError("Property 'theme' does not exist")
})
