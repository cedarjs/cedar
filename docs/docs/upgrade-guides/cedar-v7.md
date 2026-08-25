---
title: CedarJS v7.0.0
description: React 19 only
toc_max_heading_level: 4
---

## Highlights

### React 19 only

CedarJS v7 requires React 19. Every framework package that touches the web side
(`@cedarjs/web`, `@cedarjs/router`, `@cedarjs/forms`, the auth provider web
packages, Storybook, prerendering, and the streaming/SSR pipeline) is built and
typed against React 19, and the framework no longer runs its test suite against
React 18.

## Upgrade Guide

### Breaking changes

- **[React 18 support removed](#react-18-support-removed)**
- **[Storybook `legacyRootApi` option removed](#storybook-legacyrootapi-option-removed)**

If you want to see every single change in this release, including all the PRs
that went into it, check the
[release notes on GitHub](https://github.com/cedarjs/cedar/releases/tag/v7.0.0).

### Let's get started!

#### Begin with the latest v6

It's always best to start from the latest previous version. Make sure you're on
the latest v6 release and everything is working as expected before upgrading to
v7:

```bash
yarn cedar upgrade -t 6
```

#### Running the upgrade command

Now you're ready to upgrade to v7:

```bash
yarn cedar upgrade
```

If you want to try a pre-release/RC build instead, target `rc`:

```bash
yarn cedar upgrade -t rc
```

#### React 18 support removed

If your app is already on React 19 (the default for every project created with
`create-cedar-app`), there is nothing to do here.

If `web/package.json` still pins React 18, update these four entries:

```diff title="web/package.json"
  "dependencies": {
-   "react": "18.3.1",
-   "react-dom": "18.3.1"
+   "react": "19.2.3",
+   "react-dom": "19.2.3"
  },
  "devDependencies": {
-   "@types/react": "^18.2.55",
-   "@types/react-dom": "^18.2.19"
+   "@types/react": "^19.2.0",
+   "@types/react-dom": "^19.2.0"
  }
```

Then run `yarn install`.

React 19 itself has a handful of breaking changes in both runtime behavior and
TypeScript types. The React team maintains codemods that handle almost all of
them, so run those next rather than fixing type errors by hand:

```bash
# Runtime changes: ReactDOM.render → createRoot, forwardRef, defaultProps on
# function components, string refs, `act` import location, etc.
npx codemod@latest react/19/migration-recipe

# Type changes: the removed global `JSX` namespace, `useRef()` requiring an
# argument, `ReactElement.props` being `unknown`, etc.
npx types-react-codemod@latest preset-19 ./web/src
```

See the official
[React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
for the full list of changes.

One Cedar-generated file is affected by the type changes. If you scaffolded
anything with `yarn cedar g scaffold`, `web/src/lib/formatters.tsx` references
the global `JSX` namespace, which no longer exists in `@types/react` 19. The
codemod above handles this, but if you'd rather do it by hand:

```diff title="web/src/lib/formatters.tsx"
- let output: string | JSX.Element = ''
+ let output: string | React.JSX.Element = ''
```

Finally, run `yarn cedar type-check` and `yarn cedar test` to make sure
everything is happy.

#### Storybook `legacyRootApi` option removed

The `legacyRootApi` framework option is gone from `storybook-framework-cedarjs`.
React 19 has no legacy root API, so the option had no effect. If your
`web/.storybook/main.ts` sets it, remove it:

```diff title="web/.storybook/main.ts"
  framework: {
    name: 'storybook-framework-cedarjs',
    options: {
-     legacyRootApi: true,
    },
  },
```
