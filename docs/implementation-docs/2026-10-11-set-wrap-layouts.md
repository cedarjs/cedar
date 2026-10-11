# `<Set>` wrappers only get `children`

## Summary

`<Set>`, `<PrivateSet>` and `<Private>` render the components in their `wrap`
prop with the wrapped routes as `children`, and nothing else. A Set only accepts
its own props (`wrap`, `private`, `unauthenticated`, `roles`, `prerender`,
`whileLoadingAuth`, `whileLoadingPage`, plus `children` and `key`). A layout
that needs props gets them from a small, self-contained layout component that
renders it with those props hard-coded:

```tsx
function PostsScaffoldLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScaffoldLayout
      title="Posts"
      titleTo="posts"
      buttonLabel="New Post"
      buttonTo="newPost"
    >
      {children}
    </ScaffoldLayout>
  )
}

<Set wrap={PostsScaffoldLayout}>
```

The scaffold generator writes exactly this: one `<Model>ScaffoldLayout` per
scaffold, rendering the shared `ScaffoldLayout`.

This document explains how Set prop forwarding works without this change, why it
can't be typed correctly under TypeScript's `strict` mode, the typings that were
tried, what other routers do, and the resulting design.

## How Set prop forwarding works without this change

Sets are "virtual" components. They are never rendered. `analyzeRoutes`
(`packages/router/src/analyzeRoutes.ts`) walks the `<Router>` children once, and
for every Set it records an entry with the Set's `wrap` components and all its
other props:

```ts
const { children, whileLoadingPage, wrap, ...otherProps } = node.props
// ...
sets: [...previousSets, { id, wrappers, isPrivate, props: otherProps }]
```

`WrappedPage` in `router.tsx` (and in `rsc/ServerRouter.tsx`) then builds the
wrapper elements around the matched page, giving every wrapper all of the Set's
props:

```ts
set.wrappers.reduceRight(
  (acc, Wrapper, index) =>
    React.createElement(
      Wrapper,
      { ...set.props, key: set.id + '-' + index },
      acc
    ),
  page
)
```

`AuthenticatedRoute` gets `{...set.props}` too. So in

```tsx
<Set wrap={[MainLayout, ThemeLayout]} theme="dark" prerender>
```

both `MainLayout` and `ThemeLayout` receive `theme="dark"`, but also
`prerender`, and for a `<PrivateSet>` also `unauthenticated`, `roles` and
`whileLoadingAuth`.

The scaffold generator relies on this:

```tsx
<Set wrap={ScaffoldLayout} title="Posts" titleTo="posts" buttonLabel="New Post" buttonTo="newPost">
```

## Why it breaks under `strict`

The typing on `main` is:

```ts
export type WrapperType<WTProps> = (
  props: Omit<WTProps, 'wrap' | 'children'> & { children: ReactNode }
) => ReactElement | null

type SetProps<P> = P & {
  wrap?: WrapperType<P> | WrapperType<P>[]
  // ...the Set's own props
}

export function Set<WrapperProps>(props: SetProps<WrapperProps>) {}
```

`P` is inferred from the JSX attributes. In
`<Set wrap={ScaffoldLayout} titleTo="posts">`, TypeScript infers
`titleTo: string`: a string literal in an attribute widens when it's inferred
into a type parameter. `ScaffoldLayout` types `titleTo` as
`keyof typeof routes`, a union of route names. So `wrap` must accept
`(props: { titleTo: string, ... }) => ...`, and `ScaffoldLayout` is a function
that only accepts the narrower union.

Without `strictFunctionTypes`, function parameters are compared bivariantly, so
this passes because the union is assignable to `string`. With `strict` (which
turns on `strictFunctionTypes`), parameters are compared contravariantly, and a
function that needs a route name can't be used where a function that accepts any
`string` is expected. New apps get `strict` turned on in #2993, so every
generated scaffold would fail type-check.

## Typings that were tried

Every attempt fixes some cases and breaks others. The underlying design is
ambiguous (see the next section), so no typing can be right for every case.

### 1. `NoInfer<P>` on the forwarded props

```ts
type SetProps<P> = NoInfer<P> & SetOwnProps<P>
type Wrapper<P> = (props: P & { children: ReactNode }) => ReactElement | null
```

`P` is inferred from `wrap` only, so `titleTo="posts"` is checked against the
route name union, and the scaffold case type checks under `strict`.

It breaks multiple wrappers with different required props:

```tsx
<Set wrap={[PageLayout, ThemeLayout]} title="Posts" theme="dark">
// Property 'theme' is missing ...
```

For an array, TypeScript has one inference candidate per wrapper. These are
contravariant candidates, and TypeScript picks a common subtype of them, which
ends up being one wrapper's props, not the intersection of all of them. Props
that no wrapper accepts also become errors (arguably correct, but a change). The
explicit form, `<Set<{ theme: string }> wrap={ThemeLayout} theme="dark">`, keeps
working.

### 2. A `const` type parameter

```ts
export function Set<const P>(props: P & SetOwnProps<P>) {}
```

A first test passed, but for the wrong reason: `const` doesn't affect inference
from JSX attributes. In that test `P` happened to be inferred from the wrapper,
because the wrapper's `children` was optional. When every wrapper has a required
`children`, TypeScript chooses differently. Whether it uses the covariant
candidate (from the attributes) or the contravariant candidate (from the
wrapper's props) depends on whether the attribute type is assignable to the
wrapper props candidate, and `titleTo` widened to `string` again. Combining
`const` with `main`'s `WrapperType` (whose `Omit<P, 'wrap' | 'children'>` blocks
inference through it) also widened `titleTo` to `string`.

### 3. Inferring the forwarded props from the wrappers

Make the Set generic over the `wrap` value instead, and compute the forwarded
props from the wrappers' props:

```ts
type AnyWrapper = (props: any) => ReactNode
export function Set<const W extends AnyWrapper | readonly AnyWrapper[] = never>(
  props: SetOwnProps<W> &
    Omit<UnionToIntersection<PropsOfEachWrapper<W>>, 'children'>
) {}
```

This got every tested case right: route name literals, missing props, two
wrappers with different props, array props, `PrivateSet`, and Sets without
`wrap`. But it broke the documented explicit form, `<Set<{ theme: string }>>`,
because the type parameter is now the wrapper type. And when two wrappers need a
prop with the same name but different types, the best it can do is intersect
them, which is often `never`.

### 4. `main`'s types

Keeping the types on `main` means strict apps get the scaffold error. The only
fix on the app side is to type `ScaffoldLayout`'s `titleTo` and `buttonTo` as
`string`, which drops type checking of the route names.

## The problems with forwarding

The typing problems come from the design:

- **Every prop goes to every wrapper.** There's no way to say which prop is for
  which wrapper. `<Set wrap={[Context, Layout]} title="Posts">` gives `title` to
  the context provider too.
- **Same name, different types.** If two wrappers both have a `variant` prop
  with different types, no value satisfies both. TypeScript can only intersect
  them, usually to `never`.
- **Wrappers get the Set's internal props.** `private`, `unauthenticated`,
  `roles`, `prerender` and `whileLoadingAuth` are given to every wrapper, which
  is never what a layout wants.
- **Inference is fragile.** Whether a literal keeps its literal type depends on
  how TypeScript picks between inference candidates (see attempts 1–3), which
  users can't reasonably predict.

## Elements in `wrap` (considered, not done)

An alternative is to support elements in `wrap`, next to components:

```tsx
<Set wrap={<ScaffoldLayout title="Posts" titleTo="posts" />}>
<Set wrap={[MainLayout, <ThemeLayout theme="dark" />]}>
```

The router would add `children` with `cloneElement`. Each element's props are
checked by normal JSX typing, and React Router's declarative and data modes work
this way (`<Route element={<AdminLayout title="Posts" />}>`).

It's not supported. Having one way to define wrappers keeps the `wrap` type, the
router code, the generator output and the docs simple, and steers everyone to
self-contained layout components, like React Router's framework mode, RwSDK and
Wasp do. Elements also have rough edges of their own: a layout with a required
`children` prop fails type-check as `<Layout title="…" />` (its `children` would
have to be made optional), and arrays of elements in JSX trigger `react/jsx-key`
lint errors.

## How other routers handle layouts

### React Router v8

React Router never passes custom props to layouts.

- **Declarative and data mode.** A layout route is a route with an `element` (or
  `Component`) and child routes. The layout renders `<Outlet />` where the
  matched child goes:

  ```tsx
  <Route element={<AdminLayout title="Posts" />}>
    <Route path="posts" element={<PostsPage />} />
  </Route>
  ```

  Props are only possible by creating the element yourself. In data mode,
  `Component: Layout` gets no props.

- **Framework mode.** Layouts are pathless route modules in `app/routes.ts`:

  ```ts
  layout('./marketing/layout.tsx', [
    index('./marketing/home.tsx'),
    route('contact', './marketing/contact.tsx'),
  ])
  ```

  The module's default export renders `<Outlet />` and only gets route module
  props (`loaderData`, `params`, ...). Data comes from the layout's own `loader`
  and `useLoaderData`, from the child routes' `handle` exports read with
  `useMatches()` (the pattern for breadcrumbs and titles), or flows down with
  `<Outlet context>` and `useOutletContext()`.

Sources: https://reactrouter.com/start/framework/routing,
https://reactrouter.com/how-to/using-handle

### RedwoodSDK (rwsdk)

Layouts are applied with `layout()` inside `render(Document, [...])`:

```ts
render(Document, [layout(AppLayout, [route('/', HomePage)])])
```

Layouts get `children` and, for server components, `requestInfo`. Client layouts
are detected automatically. Nested `layout()` calls apply the outer layout
first. There is no way to pass custom props.

Source: https://docs.rwsdk.com/guides/frontend/layouts

### Wasp

An app has one `rootComponent`, configured in `main.wasp`. It renders React
Router's `<Outlet />` where the current page goes, and gets no custom props.

Source: https://wasp.sh/docs/project/client-config

### Conclusion

All of them make layouts self-contained components (or, in React Router's
non-framework modes, elements you create yourself). None of them forwards props
from a route grouping to its layouts. The per-use layout component is the same
idea, in Cedar's `wrap` API.

## `<Outlet>` vs `children`

React Router, in all modes, renders a layout's child route through `<Outlet />`.
The Outlet reads the next matched route from React context at render time. There
are several reasons for this:

- In declarative and data mode, the layout element (`element={<AdminLayout />}`)
  is created once, in the route config, before the matched child is known.
  `<Outlet>` means the router doesn't need to clone it with new children on
  every navigation.
- Each nesting level renders "the next match below me", without any layout
  knowing what's under it.
- The layout element itself doesn't change when only the child route changes, so
  React can skip re-rendering the layout, and only the Outlet's subtree updates.
- `<Outlet context={…} />` and `useOutletContext()` pass values down to the
  child route.

The Outlet came with React Router v6's central route config (v5 used nested
`<Switch>`es). Remix and React Router's framework mode use it too.

Cedar, like RwSDK and Next.js layouts, uses `children`: the router builds
`createElement(Wrapper, { key, children: page })`. That's plain, familiar React,
and the same layout component can be used outside routing too. The cost is that
the router creates new wrapper elements, with a new `children` prop, on every
navigation, so the layouts' render functions run again each time. They keep
their state (same component type and key, so React doesn't remount them), but
they do re-render.

An `<Outlet>`-style mechanism for Cedar would be a lot of work. Wrappers would
read the matched child from context instead of getting `children`, which changes
`WrappedPage` in `router.tsx`, route analysis, SSR and prerendering, and the
routes manifest. It also changes every layout in every app (they all render
`{children}`), the generators and their templates, and the docs and tutorial.
Nothing in this change needs it, so it's out of scope. It's a possible future
direction.

## The design

### Runtime

- `analyzeRoutes` records only the props the router needs from a Set: `private`,
  `unauthenticated`, `roles` and `whileLoadingAuth`.
- `wrapWithSetWrappers` in `Set.tsx` builds the wrapper elements for both
  `router.tsx` and `rsc/ServerRouter.tsx`. Each wrapper gets `key` and
  `children`, and no other props.
- `AuthenticatedRoute` gets `unauthenticated`, `roles` and `whileLoadingAuth`
  explicitly.
- In development (`NODE_ENV !== 'production'`), `analyzeRoutes` logs a
  `console.warn` listing a Set's unknown props, once per distinct message.
  TypeScript apps get a type error for those props, but JavaScript apps don't,
  and without the warning the props would silently do nothing.

### Types

```ts
export type WrapperType = ComponentType<{ children: ReactNode }>

interface SetProps {
  wrap?: WrapperType | readonly WrapperType[]
  private?: boolean
  unauthenticated?: string
  roles?: string | string[]
  prerender?: boolean
  children: ReactNode
  whileLoadingAuth?: () => ReactElement | null
  whileLoadingPage?: () => ReactElement | null
}

export function Set(props: SetProps) {}
```

- `Set`, `PrivateSet` and `Private` have no type parameter. Any prop that isn't
  one of the Set's own props is an excess property error.
- `WrapperType` stays exported, but describes a component in `wrap` and takes no
  type argument. A component with only optional extra props is accepted. A
  component with required extra props is rejected under `strictFunctionTypes`
  (part of `strict`). Without it, parameters are compared bivariantly and
  TypeScript accepts such a component; it then renders without those props.
- Layout props are type checked where the layout is rendered, inside the layout
  component, by ordinary JSX type checking. `titleTo="posts"` is checked against
  the route name union, also under `strict`.

Type tests are in `packages/router/src/__typetests__/setWrap.test.tsx`.

### Generator output

For `yarn cedar g scaffold post`:

- `web/src/layouts/ScaffoldLayout/ScaffoldLayout.{tsx,jsx}`, shared by all
  scaffolds and only written if it doesn't exist (or with `--force`), as before.
- `web/src/layouts/PostsScaffoldLayout/PostsScaffoldLayout.{tsx,jsx}`, from the
  `NamesScaffoldLayout.tsx.template` template. It renders `ScaffoldLayout` with
  `title`, `titleTo`, `buttonLabel` and `buttonTo` for the model.
- `Routes` gets
  `import PostsScaffoldLayout from 'src/layouts/PostsScaffoldLayout'` and
  `<Set wrap={PostsScaffoldLayout}>`, inside a `<PrivateSet>` when the app has
  auth set up.

For a nested scaffold, `g scaffold admin/post`, the layout is at
`web/src/layouts/Admin/PostsScaffoldLayout/PostsScaffoldLayout.tsx`, and Routes
imports it as `AdminPostsScaffoldLayout`, with the path as a prefix, like nested
scaffold pages (`AdminPostPostsPage`). The route names in it (`adminPosts`,
`adminNewPost`) include the path too.

The layout templates are resolved one file at a time, so a project with custom
scaffold templates in `generatorTemplates/web/scaffold/layouts` that only has
`ScaffoldLayout.tsx.template` still gets the default
`NamesScaffoldLayout.tsx.template`.

`yarn cedar d scaffold post` deletes the model's layout (but not the shared
`ScaffoldLayout`), removes its import from Routes, removes the then empty
`<Set wrap={PostsScaffoldLayout}>`, and removes the `<PrivateSet>` around it
when that's empty too.

### Upgrade script

`upgrade-scripts/8.x.ts` runs before `yarn cedar upgrade` installs v8. It parses
every `.js`, `.jsx`, `.ts` and `.tsx` file in `web/src` that contains `<Set`,
`<PrivateSet` or `<Private` with `oxc-parser`, and reports each Set with props
other than its own props: the file, line, the Set's `wrap` value and the prop
names. It then explains what to do (create a layout component that renders the
wrapper with those props hard-coded, like the generated `PostsScaffoldLayout`,
and use it in `wrap`), and exits non-zero. A failing pre-upgrade script stops
the upgrade (unless `--force` is passed) and shows the script's output to the
user. The fix works with the user's current Cedar version too, so the user can
make it, and run the upgrade again.

The script only detects and reports. It doesn't rewrite any code, because:

- It can't know which props belong to which wrapper. For
  `wrap={[MainLayout, ThemeLayout]} theme="dark"`, every wrapper got `theme`,
  but most likely only one of them uses it.
- The fix is new components in the user's code. A human should name them and
  decide where they live, and possibly share one between several Sets.

The script's tests (`upgrade-scripts/8.x.test.ts`) run it against the fixture
projects in `upgrade-scripts/__fixtures__/8.x-set-wrapper-props`: a TypeScript
project with Sets with forwarded props (one wrapper, several wrappers,
`<PrivateSet>`, `<Private>`, and a Set outside `Routes.tsx`), a JavaScript
project, and a project where all Sets only use their own props.

## Possible follow-up

Some layouts vary by the active route, like a page title or breadcrumbs. React
Router solves this with `handle` exports and `useMatches()`. Cedar could add
something similar, like route-level metadata that a layout reads for the active
route. That's not part of this change.
