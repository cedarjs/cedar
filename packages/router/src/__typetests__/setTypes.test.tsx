import type { ReactNode } from 'react'

import { expect, test } from 'tstyche'

import { PrivateSet, Set } from '@cedarjs/router'

type Page = 'home' | 'posts'

const PageLayout = (props: {
  title: string
  titleTo: Page
  children: ReactNode
}) => <div>{props.children}</div>

const PlainLayout = (props: { children?: ReactNode }) => (
  <div>{props.children}</div>
)

test('Set checks forwarded props against the wrapper props', () => {
  expect(
    <Set wrap={PageLayout} title="Posts" titleTo="posts">
      <div />
    </Set>,
  ).type.not.toRaiseError()

  expect(
    <Set wrap={PageLayout} title="Posts" titleTo="nope">
      <div />
    </Set>,
  ).type.toRaiseError(`Type '"nope"' is not assignable to type 'Page'`)

  expect(
    <Set wrap={PageLayout} title="Posts">
      <div />
    </Set>,
  ).type.toRaiseError(`Property 'titleTo' is missing`)
})

test('Set supports multiple wrappers', () => {
  expect(
    <Set wrap={[PlainLayout, PageLayout]} title="Posts" titleTo="home">
      <div />
    </Set>,
  ).type.not.toRaiseError()
})

test('Set without wrap', () => {
  expect(
    <Set prerender>
      <div />
    </Set>,
  ).type.not.toRaiseError()
})

test('Set with explicit wrapper props', () => {
  const Themed = (props: { theme: string; children: ReactNode }) => (
    <div>{props.children}</div>
  )

  expect(
    <Set<{ theme: string }> wrap={Themed} theme="dark">
      <div />
    </Set>,
  ).type.not.toRaiseError()
})

test('PrivateSet checks forwarded props against the wrapper props', () => {
  expect(
    <PrivateSet
      unauthenticated="home"
      wrap={PageLayout}
      title="Posts"
      titleTo="posts"
    >
      <div />
    </PrivateSet>,
  ).type.not.toRaiseError()

  expect(
    <PrivateSet
      unauthenticated="home"
      wrap={PageLayout}
      title="Posts"
      titleTo="nope"
    >
      <div />
    </PrivateSet>,
  ).type.toRaiseError(`Type '"nope"' is not assignable to type 'Page'`)
})
