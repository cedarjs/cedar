# CLI Packages - Storybook Vite

This CLI package is intended to be used with the [Storybook Framework package](../../storybook/README.md).
Get started as follows:

- Run `yarn cedar storybook` from your project. This will:
  - Add the necessary config files, if they don't already exist:
    `web/.storybook/{main.ts + preview-body.html}`.
  - Create the Mock Service Worker, which is needed for all Cell mocking.
  - Run Storybook.
