# Repository Guidelines

## Project Structure & Module Organization

- Monorepo managed with Nx + Yarn workspaces.
- Source packages live under `packages/` (framework packages, adapters, auth providers, CLI packages, mailer, templates).
- Shared tooling and scripts live in `tasks/` and `upgrade-scripts/`.
- Test fixtures live in `__fixtures__/` and `test-project/`.
- Docs and reference material are in `docs/` and top-level `README.md`.

## Build, Test, and Development Commands

- `yarn install`: install dependencies (Yarn v4 as pinned in `package.json`).
- `yarn build`: build all packages via Nx.
- `yarn build:clean`: remove prior build output, then rebuild.
- `yarn lint` / `yarn lint:fix`: run ESLint across packages (or auto-fix).
- `yarn format` / `yarn format:check`: run Prettier write/check.
- `yarn test`: run package tests via Nx.
- `yarn test:types`: run type-level tests.
- `yarn e2e`: run Cypress-based integration flow in a temp project.

## Coding Style & Naming Conventions

- Formatting is enforced by Prettier (`tabWidth: 2`, `singleQuote: true`, `semi: false`, `trailingComma: all`).
- ESLint config is in `eslint.config.mjs` and is expected to pass on CI.
- Prefer consistent package naming and scopes: `packages/<area>/<name>`.
- Keep file and symbol names aligned with existing package conventions.

## Type Safety & Casting

- Prefer precise types and type guards over casts whenever possible.
- Use `unknown` for values from untyped/external boundaries (catch variables, dynamic module imports, process/env payloads) and narrow before use.
- Use type assertions (`as`) only as a last resort after narrowing or introducing a local type alias/interface is not practical.
- Avoid `as any`. If `any` is truly unavoidable, add a short inline comment that explains why and what boundary/limitation requires it.
- Every non-obvious cast must include a short comment describing why it is safe or necessary.
- Avoid chained assertions unless required (e.g. `as unknown as X` at library typing boundaries); document why when used.
- When filtering arrays, prefer typed predicates (e.g. `(v): v is T => Boolean(v)`) instead of broad casts like `as T[]`.

## Testing Guidelines

- Unit/integration tests are executed through `yarn test` (Nx targets).
- Type tests use `yarn test:types`.
- E2E coverage uses Cypress via `yarn e2e`.
- When adding tests, follow local package naming patterns and keep tests colocated with the package.

## Commit & Pull Request Guidelines

- Commit history follows Conventional Commits with scopes, e.g. `feat(realtime): ...`, `fix(cli): ...`, `chore(deps): ...`.
- PRs should include a clear summary, testing notes (commands run), and linked issues when applicable.
- Add screenshots or CLI output when changes affect user-facing behavior.

## Agent-Specific Notes

- Prefer `rg` for searching and keep changes focused to the relevant package(s).
- Avoid touching unrelated files unless required by the change.
