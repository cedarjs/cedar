---
description: A component-driven development workflow
---

# Storybook

[Storybook](https://storybook.js.org) enables the kind of frontend-first, component-driven development workflow that we've always wanted.
By developing your UI components in isolation, you get to focus exclusively on your UI's needs,
saving you from getting too caught up in the details of your API too early.

Storybook also makes debugging a lot easier.
You don't have to start the dev server, login as a user, tab through dropdowns, and click buttons just for that one bug to show up.
And say goodbye to rendering a whole page and make six GraphQL calls just to change the color of a modal!
You can set up every component as a story and tweak it within Storybook. And for any [cells](./cells.md), [mocking GraphQL could not be easier!](./how-to/mocking-graphql-in-storybook.md)

CedarJS offers a Storybook integration leveraging Storybook's [Framework Packages](https://storybook.js.org/docs/7/configure/integration/frameworks),
using Vite as its bundler to align with your production project.

## Getting Started with Storybook

You can start Storybook with `yarn cedar storybook`:

```
yarn cedar storybook
```

If this is your first time running Storybook:

- The Cedar CLI will install Storybook, the framework package, and all related dependencies.
- The Cedar CLI will create the following config files for you:
  - `web/.storybook/main.ts`
    - This is the primary [Storybook configuration file](https://storybook.js.org/docs/7/configure). Note that it references our framework package, [`storybook-framework-cedarjs`](https://www.npmjs.com/package/storybook-framework-cedarjs).
  - `web/.storybook/preview-body.html`
    - This is required to change the `id` of the root div to `redwood-app`, which is what the entry file used by Vite requires.

Once Storybook is all set up, it'll spin up on localhost port `7910` and open your browser.

## Configuring Storybook

To configure Storybook, please follow [the official Storybook docs](https://storybook.js.org/docs/7/configure).
