# CedarJS Project Context

## Project Overview

**CedarJS** is an opinionated, full-stack React framework designed for speed and developer experience. It integrates React (frontend), GraphQL (API), and Prisma (database) into a cohesive package.

- **Origin:** Fork of [RedwoodJS](https://github.com/redwoodjs/redwood).
- **Key Differentiators:** Active maintenance, experimental ESM support, recurring jobs, and modern standard adoption (e.g., Node 24 support).
- **Architecture:** Monorepo managed with Yarn Workspaces, Lerna, and Nx.

## Monorepo Structure

- **`packages/`**: Contains the core framework packages.
  - `api`, `web`: Core runtime packages.
  - `cli`: The `cedar` command-line interface.
  - `api-server`, `graphql-server`: Server-side logic.
  - `auth`, `auth-providers`: Authentication modules.
  - `create-cedar-app`: The scaffolding tool for new projects.
- **`tasks/`**: Maintenance scripts for building, testing, and release management.
- **`__fixtures__/`**: Test projects used for integration testing.

## Building and Running

This project is a framework monorepo. You typically develop _on_ the framework or use the framework to build an _app_.

### Core Commands

| Command            | Description                                                                            |
| :----------------- | :------------------------------------------------------------------------------------- |
| `yarn install`     | Install dependencies (uses Yarn v4).                                                   |
| `yarn build`       | Build all packages using Nx.                                                           |
| `yarn build:clean` | Clean build artifacts.                                                                 |
| `yarn test`        | Run unit tests for all packages. Use `CI=1` to ensure non-interactive mode.            |
| `yarn lint`        | Run ESLint checks.                                                                     |
| `yarn lint:fix`    | Fix ESLint errors automatically.                                                       |
| `yarn format`      | Format code with Prettier.                                                             |
| `yarn e2e`         | Run end-to-end tests (requires Cypress). Use `CI=1` for headless/non-interactive mode. |

### Running Commands on Specific Packages

To run commands on individual packages in the monorepo, use `yarn workspace`:

```bash
yarn workspace @cedarjs/internal test
yarn workspace @cedarjs/cli build
```

This is useful for faster iteration when working on a specific package.

### Development Workflow

To test framework changes against a real Cedar project:

1.  **Sync Method (Recommended):**
    - Navigate to your target Cedar project.
    - Run: `CFW_PATH=/path/to/cedar-gemini yarn cfw project:sync`
    - This builds the framework, copies dependencies, and watches for changes.

2.  **CLI Dev Method:**
    - Useful for testing CLI changes without full sync.
    - `cd packages/cli`
    - `yarn dev <command> --cwd /path/to/target/project`

3.  **Test Project Generation:**
    - Create a fresh test project with current framework code: `yarn build:test-project <path-to-new-project>`

## Development Conventions

- **Package Manager:** Yarn v4 (Berry). Do not use npm.
- **Versioning:** Uses `changesets` for version management.
- **Code Style:**
  - **Linting:** ESLint (`eslint.config.mjs`).
  - **Formatting:** Prettier.
  - **Constraints:** Yarn constraints ensure consistent dependency versions across the monorepo.
- **Testing:**
  - Unit tests: Jest/Vitest. When running `vitest` directly, use `--run` to disable watch mode.
  - E2E: Cypress and Playwright.
- **Dependencies:**
  - Avoid introducing new dependencies unless necessary.
  - Use `yarn dedupe` to manage duplicate packages.
  - Keep `package.json` files sorted (`yarn check`).

## Key Configuration Files

- `package.json`: Root scripts and dev dependencies.
- `nx.json`: Nx configuration for task running and caching.
- `lerna.json`: Lerna configuration for versioning/publishing.
- `CONTRIBUTING.md`: Detailed contribution guidelines.
