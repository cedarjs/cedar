<p align="center">
  <img src="https://avatars.githubusercontent.com/u/211931789?s=200&v=4" width="200" />
  <h1 align="center">CedarJS</h1>
  <p align="center">
    <a href="https://cedarjs.com/discord">
      <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord server!"
    /></a>
    <a href="https://cedarjs.com">
      <img src="https://img.shields.io/badge/Documentation-3ECC5F?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation" />
    </a>
  </p>
</p>

<br>
<h2 align="center">The App Framework for Startups</h2>

<h3 align="center">Ship today with architecture for tomorrow.</h3>

CedarJS is an opinionated framework for modern multi-client applications, built on React, GraphQL, and Prisma with full TypeScript support and ready to go with zero config.

Want great developer experience and easy scaling? How about an integrated front- and back-end test suite, boilerplate code generators, component design, logging, API security + auth, and serverless or traditional deploy support? Cedar is here! Cedar works with the components and development workflow you love but with simple conventions and helpers to make your experience even better.

<h2>Quick Start</h2>

CedarJS requires Node.js =20.x.

```bash
yarn create cedar-app my-cedar-app
cd my-cedar-app
yarn install
yarn cedarjs dev
```

<h3>Resources</h3>

- The [CedarJS Tutorial](https://cedarjs.com/docs/tutorial): the best way to learn CedarJS
- The [Cedar CLI](https://cedarjs.com/docs/cli-commands): code generators, DB helpers, setup commands, and more
- [Documentation](https://cedarjs.com/docs) and [How To's](https://cedarjs.com/how-to/custom-function)
- Join our [Discord Chat](https://cedarjs.com/discord)

<h2>Contributing to create-cedar-app</h2>

_Contributors are Welcome! Get started [here](https://cedarjs.com/docs/contributing). And don't hesitate to ask for help on the chat_.

**Table of Contents**

<!-- toc -->

- [Description](#description)
- [Local Development](#local-development)
  - [Installation Script](#installation-script)
  - [Template Codebase](#template-codebase)
  - [How to run create-cedar-app and create a project](#how-to-run-create-cedar-app-and-create-a-project)
  - [Develop using the new project](#develop-using-the-new-project)

## Description

This package creates and installs a Cedar project, which is the entry point for anyone using CedarJS. It has two parts:

- The installation script [`src/create-cedar-app.js`](./src/create-cedar-app.js)
- Project template code in the [`templates/`](./templates/) directory

## Local Development

### Installation Script

The installation script is built with [Yargs](https://github.com/yargs/yargs).

### Template Codebase

The project codebase in [`templates/`](./templates/) uses [Yarn Workspaces](https://yarnpkg.com/features/workspaces) for a monorepo project containing the API and Web Sides. Cedar packages are included in `templates/ts/package.json`, `templates/ts/web/package.json`, and `templates/ts/api/package.json`, respectively.

### How to run `create-cedar-app` from your local repo and create a project

First, run the following commands in the root of the monorepo:

```bash
yarn install
yarn build
```

Then, navigate to the create-cedar-app package:

```bash
cd packages/create-cedar-app
```

Run `yarn node` on the built file (`dist/create-cedar-app.js`) and pass in the path to the new project:

```bash
yarn node ./dist/create-cedar-app.js /path/to/new/cedar-app
```

> [!NOTE]
> the new project will install with the most recent major CedarJS package version by default.

### How to run other published versions for debugging

By default yarn create will pick the latest stable version to run, but you can specify a different version via yarn too!

To try the canary version, run:

```
npx create-cedar-app@canary /path/to/project
```

Note that this will still create a project with the latest stable version, but run the canary version of create-cedar-app, and is mainly useful for debugging this package, and not the CedarJS canary release.

You can specify any tag or version instead of `@canary`

### Develop using the new project

There are three options for developing with the installed project:

**1. Upgrade the project to use the latest canary release**

```bash
cd /path/to/new/cedar-app
yarn rw upgrade -t canary
```

**2. Use the workflow and tools for local package development**

- [Local Development Instructions](https://github.com/cedarjs/cedar/blob/main/CONTRIBUTING.md)
