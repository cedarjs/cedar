# TypeScript

See [typescript/taste.md](typescript/taste.md)

# Prisma

- Use `prisma-client` provider (not `prisma-client-js`) — `prisma-client-js` is legacy Prisma v6 config and should not be used anywhere. Confidence: 0.85

# Architecture

- Keep package-manager-specific logic out of handler files. Extract PM logic into helpers from `cli-helpers` rather than inlining it in individual command handlers. Confidence: 0.80
- CedarJS only supports Apollo Client for GraphQL. Remove abstractions/wrappers that suggest alternative GraphQL clients are supported. Confidence: 0.75
- CedarJS owns zero deployment adapters. The framework's only UD responsibility is calling `addEntry()` from `@universal-deploy/store` with WinterTC-compatible handler paths. Cloudless server-side serving uses `srvx` in the Cedar CLI directly (no Cedar-owned adapter package for Node, and no UD adapter needed for that path). Provider-specific adapter logic for Netlify/Vercel/Cloudflare belongs to Universal Deploy adapters, not Cedar. Confidence: 0.90
- Cedar apps default to CJS + Jest (not vitest). Only ESM-template apps use vitest. Confidence: 0.85

# Workflow

See [workflow/taste.md](workflow/taste.md)

# Code-Style

See [code-style/taste.md](code-style/taste.md)

# Documentation

- Describe the user-facing command/workflow rather than the underlying codegen step that happens automatically. Docs should reflect what users actually do, not internal implementation details. Confidence: 0.75
- Be precise in technical writing: name specific tokens/variables (e.g., `GITHUB_TOKEN` not "the token"), avoid contradictory phrasing, and explain the "why" behind design decisions. Confidence: 0.65

# Docusaurus

- Use Docusaurus' `useColorMode` hook for light/dark mode theming instead of custom CSS-only solutions. Confidence: 0.75

# Prettier

- For markdown files: `proseWrap: "always"` should only apply to new files (not in git history). Existing files get minor edits without rewrapping. Use a git-aware script rather than adding proseWrap to the global Prettier config. Confidence: 0.75

# Cedar Apps CLI

- Cedar ships a CLI that Cedar Apps use. The CLI is invoked by the `yarn cedar` prefix (e.g., `yarn cedar dev`, `yarn cedar build`), not bare `yarn dev`/`yarn build`. Confidence: 0.80
- Always use `yarn cedar` (not bare `cedar`) in CLI usage examples since Cedar is not installed as a global binary. Confidence: 0.70

# Cedar Deploy Config

- The `packageManagerCommand` config field in `deploy.toml` / `DEFAULT_SERVER_CONFIG` is a deliberate user-facing escape hatch: it lets users run a different package manager (or a wrapper like `doppler run -- yarn`) on the deployment server than they use locally. When restructuring deploy code, preserve the ability for this field to override PM behavior — don't collapse it into a PM auto-detected value. Confidence: 0.85

# Architecture

- Neon Postgres (`@prisma/adapter-pg`) does not require ESM at runtime. The `--esm` requirement in `create-cedar-app`'s `handle-args.ts` is a scaffolding-time guard only. Do not force CJS→ESM conversion when adding Neon to existing projects. Confidence: 0.85

# CLI

- Avoid using `rg` (ripgrep) in CLI tools that run on user machines — it's not guaranteed to be installed, especially on Windows. Use Node.js built-in `fs` methods or other universally available approaches instead. Confidence: 0.70
- `getPackageManager()` detects PM primarily via `npm_config_user_agent` env var (set automatically by whichever PM runs the command), then falls back to lockfile detection. The `packageManager` field in `package.json` is NOT read by `getPackageManager()`. Confidence: 0.95
- npm does not support the `workspace:*` protocol. When running `npm install` on a project that has `workspace:*` deps, replace them with `file:` references first. pnpm and yarn both support `workspace:*` natively. Confidence: 0.90
- pnpm's `pnpm install` checks the `packageManager` field in `package.json` and refuses to run if it specifies a different PM (e.g., `yarn@4.14.1`). Update it to `pnpm` before running install. Confidence: 0.90

# Debugging

See [debugging/taste.md](debugging/taste.md)

# node

- Cedar requires Node 24+. --experimental-strip-types is unflagged and not needed. Confidence: 0.90
- When forwarding a request body via `fetch()` in Cedar server code (e.g., API proxy middleware), include `duplex: 'half'` in the `RequestInit` with a `@ts-expect-error` and explanatory comment. Node 18+ fetch requires this option when streaming a body; without it, POST requests silently fail with `TypeError: RequestInit: duplex option is required when sending a body.` The DOM lib types don't yet include it. Confidence: 0.90

# Web Serve

- For SPA fallback in `cedar serve` (both Fastify and `--ud` srvx paths), use `web/dist/200.html` (unprerendered shell) when it exists, otherwise fall back to `web/dist/index.html`. Returning the prerendered `index.html` for non-prerendered routes makes the client think the page was prerendered and crashes on `prerenderLoader(name).default` when the page module isn't in `__REDWOOD__PRERENDER_PAGES`. Mirror the Fastify web adapter's logic at `packages/adapters/fastify/web/src/web.ts`. Confidence: 0.85

# Process Management

- Never use `pkill` or `killall` to mass-kill processes by name (e.g., `pkill -9 node`). Only kill specific PIDs that you know are safe to terminate. Mass-killing can destroy the user's browser sessions, chat apps, and other work. Confidence: 0.85

# CI / GitHub Actions

- When a workflow step uses `working-directory` and passes a path to the test project via an env var (e.g., `CEDAR_TEST_PROJECT_PATH`), use `${{ github.workspace }}/../path` rather than a relative path. The relative path resolves against the `working-directory`, not the workspace root. Confidence: 0.80
- When a conditional job (`if:`) has no `strategy.matrix`, GitHub creates no job entry at all if the condition is false. Jobs referencing it in `needs` then fail. Always add a dummy matrix (e.g., `strategy.matrix: { os: [ubuntu-latest] }`) so skipped jobs appear as "skipped" entries that `ci-status-check` handles correctly. Confidence: 0.90
- Do not use `inputs` expressions (e.g., `inputs.packageManager`) in job-level `if:` or `concurrency.group` of a `workflow_call` workflow that also has a `schedule` trigger. GitHub cannot resolve `inputs` at parse time for `schedule` triggers, causing the workflow to silently fail with 0 jobs. Remove `inputs` entirely or use a separate matrix approach. Confidence: 0.85
