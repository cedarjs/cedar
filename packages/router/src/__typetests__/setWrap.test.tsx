import type { ReactNode } from 'react'

import { expect, test } from 'tstyche'

import { Private, PrivateSet, Set } from '@cedarjs/router'
import type { WrapperType } from '@cedarjs/router'

const MainLayout = ({ children }: { children: ReactNode }) => (
  <main>{children}</main>
)

const OptionalPropsLayout = ({
  children,
  theme,
}: {
  children: ReactNode
  theme?: 'light' | 'dark'
}) => <div className={theme}>{children}</div>

const ScaffoldLayout = ({
  children,
  title,
  titleTo,
}: {
  children: ReactNode
  title: string
  titleTo: 'posts' | 'newPost'
}) => (
  <div>
    <h1>
      {title} ({titleTo})
    </h1>
    {children}
  </div>
)

const PostsScaffoldLayout = ({ children }: { children: ReactNode }) => (
  <ScaffoldLayout title="Posts" titleTo="posts">
    {children}
  </ScaffoldLayout>
)

test('wrap accepts a component that only needs children', () => {
  expect(<Set wrap={MainLayout}>{null}</Set>).type.not.toRaiseError()
})

test('wrap accepts a component with optional extra props', () => {
  expect(<Set wrap={OptionalPropsLayout}>{null}</Set>).type.not.toRaiseError()
})

test('wrap accepts a layout component that renders a layout with props', () => {
  expect(<Set wrap={PostsScaffoldLayout}>{null}</Set>).type.not.toRaiseError()
})

test('layout props are type checked where the layout is rendered', () => {
  expect(
    <ScaffoldLayout title="Posts" titleTo="post">
      {null}
    </ScaffoldLayout>,
  ).type.toRaiseError(`Type '"post"' is not assignable`)
})

test('wrap rejects a component with required extra props', () => {
  expect(<Set wrap={ScaffoldLayout}>{null}</Set>).type.toRaiseError(
    'is not assignable to type',
  )
})

test('wrap rejects elements', () => {
  expect(
    <Set wrap={<ScaffoldLayout title="Posts" titleTo="posts" />}>{null}</Set>,
  ).type.toRaiseError()
})

test('wrap accepts arrays of components', () => {
  expect(
    <Set wrap={[MainLayout, PostsScaffoldLayout, OptionalPropsLayout]}>
      {null}
    </Set>,
  ).type.not.toRaiseError()

  expect(
    <Set wrap={[MainLayout, ScaffoldLayout]}>{null}</Set>,
  ).type.toRaiseError()
})

test('wrap accepts readonly arrays of WrapperType', () => {
  const wrappers: readonly WrapperType[] = [MainLayout, PostsScaffoldLayout]

  expect(<Set wrap={wrappers}>{null}</Set>).type.not.toRaiseError()
})

test('Set rejects props it does not use', () => {
  expect(
    <Set wrap={ScaffoldLayout} title="Posts">
      {null}
    </Set>,
  ).type.toRaiseError()

  expect(
    <Set wrap={MainLayout} theme="dark">
      {null}
    </Set>,
  ).type.toRaiseError("Property 'theme' does not exist")
})

test('Set has no type parameter for forwarded props', () => {
  expect(
    <Set<{ theme: string }> wrap={MainLayout}>{null}</Set>,
  ).type.toRaiseError('Expected 0 type arguments')
})

test('PrivateSet accepts wrappers like Set does', () => {
  expect(
    <PrivateSet
      unauthenticated="login"
      roles={['admin']}
      wrap={[MainLayout, PostsScaffoldLayout]}
    >
      {null}
    </PrivateSet>,
  ).type.not.toRaiseError()

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

test('PrivateSet requires unauthenticated', () => {
  expect(<PrivateSet wrap={MainLayout}>{null}</PrivateSet>).type.toRaiseError(
    "Property 'unauthenticated' is missing",
  )
})

test('Private rejects props it does not use', () => {
  expect(
    <Private unauthenticated="login" wrap={MainLayout}>
      {null}
    </Private>,
  ).type.not.toRaiseError()

  expect(
    <Private unauthenticated="login" wrap={MainLayout} theme="dark">
      {null}
    </Private>,
  ).type.toRaiseError("Property 'theme' does not exist")
})
