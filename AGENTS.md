# Repository Guidelines

## Project Overview

**CedarJS** is an opinionated, full-stack React framework (frontend: React, API: GraphQL, database: Prisma) forked from [RedwoodJS](https://github.com/redwoodjs/redwood). Active maintenance, experimental ESM support, recurring jobs, and modern Node support (Node 24+).

## Project Structure & Module Organization

- Monorepo managed with Nx + Yarn workspaces.
- Source packages live under `packages/` (framework packages, adapters, auth providers, CLI packages, mailer, templates).
- Shared tooling and scripts live in `tasks/` and `upgrade-scripts/`.
- Test fixtures live in `__fixtures__/`
- Cedar test apps for local testing live in `local-testing-project` and `local-testing-project-live`
- Docs and reference material are in `docs/` and top-level `README.md`.

## Build, Test, and Development Commands

- `yarn install`: install dependencies (Yarn v4 as pinned in `package.json`). Do not use npm.
- `yarn build`: build all packages via Nx.
- `yarn build:clean`: remove prior build output, then rebuild.
- `yarn lint` / `yarn lint:fix`: run ESLint across packages (or auto-fix).
- `yarn format` / `yarn format:check`: run Prettier write/check.
- `yarn test`: run package tests via Nx. Use `CI=1` for non-interactive mode.
- `yarn test:types`: run type-level tests.
- `yarn e2e`: run end-to-end tests (requires Cypress). Use `CI=1` for headless mode.

To run commands on a single package:

```bash
yarn workspace @cedarjs/cli build
yarn workspace @cedarjs/internal test
```

## Development Workflow

To test framework changes against a real Cedar project:

1. **Sync method (recommended):** navigate to your target Cedar project and run `CFW_PATH=/path/to/cedar yarn cfw project:sync` — builds the framework, copies dependencies, watches for changes.
2. **CLI dev method:** useful for testing CLI changes without a full sync: `cd packages/cli && yarn dev <command> --cwd /path/to/target/project`
3. **Test project generation:** create a fresh test project with current framework code: `yarn build:test-project <path-to-new-project>`

Use `yarn dedupe` to manage duplicate packages. Keep `package.json` files sorted (`yarn check`).

## Coding Style & Naming Conventions

- Formatting is enforced by Prettier (`tabWidth: 2`, `singleQuote: true`, `semi: false`, `trailingComma: all`).
- ESLint config is in `eslint.config.mjs` and is expected to pass on CI.
- Prefer consistent package naming and scopes: `packages/<area>/<name>`.
- Keep file and symbol names aligned with existing package conventions.
- Place comments on a separate line immediately above the affected code using `//`. For documenting function/variable usage, use JSDoc. Avoid inline or end-of-line comments.
- Avoid introducing new dependencies unless necessary.

## Type Safety & Casting

- Prefer precise types and type guards over casts whenever possible.
- Use `unknown` for values from untyped/external boundaries (catch variables, dynamic module imports, process/env payloads) and narrow before use.
- Use type assertions (`as`) only as a last resort after narrowing or introducing a local type alias/interface is not practical.
- Avoid `as any`. If `any` is truly unavoidable, add a short inline comment that explains why and what boundary/limitation requires it.
- Every non-obvious cast must include a short comment describing why it is safe or necessary.
- Avoid chained assertions unless required (e.g. `as unknown as X` at library typing boundaries); document why when used.
- When filtering arrays, prefer typed predicates (e.g. `(v): v is T => Boolean(v)`) instead of broad casts like `as T[]`.
- **Never use `@ts-ignore`.** Always prefer `@ts-expect-error` with a clear explanation of why it's needed.
- **Never use `e as Error` in try/catch clauses.** The caught value is `unknown` and may not be an `Error`. Always narrow the type properly, e.g.:
  ```ts
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
  }
  ```

## Testing Guidelines

- Unit/integration tests are executed through `yarn test` (Nx targets). When running `vitest` directly, use `--run` to disable watch mode.
- Type tests use `yarn test:types`.
- E2E: Cypress and Playwright.
- When adding tests, follow local package naming patterns and keep tests colocated with the package.
- For larger changes, run `yarn build && yarn build:pack` to generate package tarballs, then run `yarn install` inside `local-testing-project` to verify your changes inside an actual Cedar application.

## Commit & Pull Request Guidelines

- Commit history follows Conventional Commits with scopes, e.g. `feat(realtime): ...`, `fix(cli): ...`, `chore(deps): ...`.
- PRs should include a clear summary, testing notes (commands run), and linked issues when applicable.
- Add screenshots or CLI output when changes affect user-facing behavior.
- Use `gh api repos/cedarjs/cedar/pulls/<pr-number>/comments --jq '.[] | {user: .user.login, path: .path, line: .line, body: .body}'` to get review comments for a PR. If you don't already know the PR number you can run `gh pr view --json number --jq .number` to get it

## Agent-Specific Notes

- Prefer `rg` for searching and keep changes focused to the relevant package(s).
- Avoid touching unrelated files unless required by the change.

## E2E Netlify Deploy Test

- Test files in `tasks/netlify-tests/`:
  - `vitest.config.mts` — vitest runner config (setupFiles, include patterns)
  - `vitest.setup.mts` — validates `NETLIFY_DEPLOY_URL` env var, sets `process.env.DEPLOY_URL`
  - `netlify.test.mts` — tests API `handleRequest`, legacy handlers, and web SPA shell against deployed Netlify URL
- CI workflow in `.github/workflows/e2e-netlify.yml`:
  - Uses `__fixtures__/test-project-esm/` as the test project (ESM, needed by Netlify vite plugin)
  - Runs tarsync to link local packages
  - Removes SQLite migrations (`rm -rf api/db/migrations`), then runs `yarn cedar setup neon` to provision a fresh Neon Postgres database and create Postgres baseline migration
  - Links site with `netlify link --id "$SITE_ID" --filter web`
  - Runs `yarn cedar setup deploy universal-deploy`, then `yarn cedar setup deploy netlify --ud`
  - Builds locally (`yarn cedar build --ud --apiRootPath=/.api/functions`, then `yarn cedar prisma migrate deploy`, then `yarn cedar data-migrate up`) using `.env` database URLs
  - Sets `DATABASE_URL` and `DIRECT_DATABASE_URL` on the Netlify site via `netlify env:set --filter web` for runtime access
  - Deploys via `npx netlify deploy --filter web --prod --json --no-build`
  - All test-project commands use `working-directory: ../cedar-test-app` (not `CEDAR_CWD`)
- CI orchestration in `.github/workflows/ci.yml` — `e2e-netlify` job calls the workflow, runs only on `cedarjs/cedar` repo
- API function URLs on Netlify use `/.api/functions/<name>` (configured via `apiRootPath`; routed through the `server` function from `@netlify/vite-plugin` which has `path: "/*"`)
- Fixture functions in `__fixtures__/test-project-esm/api/src/functions/`:
  - `hello.ts` — `handleRequest` export, returns `{ data, url }`
  - `legacyHello.ts` — legacy handler export, returns `{ data }`
  - Both created by step 11 of `tasks/test-project/rebuild-test-project-fixture.mts`
- Secrets `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` are set as GitHub secrets
