# TypeScript

See [typescript/taste.md](typescript/taste.md)

# Prisma

- Use `prisma-client` provider (not `prisma-client-js`) — `prisma-client-js` is legacy Prisma v6 config and should not be used anywhere. Confidence: 0.85

# Architecture

- CedarJS only supports Apollo Client for GraphQL. Remove abstractions/wrappers that suggest alternative GraphQL clients are supported. Confidence: 0.75
- CedarJS owns zero deployment adapters. The framework's only UD responsibility is calling `addEntry()` from `@universal-deploy/store` with WinterTC-compatible handler paths. Cloudless server-side serving uses `srvx` in the Cedar CLI directly (no Cedar-owned adapter package for Node, and no UD adapter needed for that path). Provider-specific adapter logic for Netlify/Vercel/Cloudflare belongs to Universal Deploy adapters, not Cedar. Confidence: 0.90
- Cedar apps default to CJS + Jest (not vitest). Only ESM-template apps use vitest. Confidence: 0.85

# Workflow

- After making code changes, verify by running: prettier, eslint, unit tests, and tsc on changed files before considering the change complete. Confidence: 0.80
- Add tests one at a time, verifying each passes before adding the next test. Confidence: 0.70
- Maintain backwards compatibility in semver minor releases; no mandatory breaking changes. Confidence: 0.75
- When uncertain whether a command/pattern works across package managers or platforms, test it empirically on the user's machine rather than deferring to existing patterns or speculating about edge cases. "Is this PM-agnostic?" is a question to answer by running the command, not by trusting prior assumptions. Confidence: 0.75
- Users never regenerate Cedar apps from templates. CedarJS guides them through manual updates and provides codemods to help them upgrade. Don't assume changes to template files will reach existing apps. Assume instead that they need migration paths. Confidence: 0.85

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

# Debugging

- When reproducing bugs, validate against realistic production code paths (e.g., curl against a running server) rather than synthetic/unit-level demonstrations that load modules in isolation. The repro should prove the bug happens in real usage. Confidence: 0.75
- When designing E2E tests for deployment paths, exercise the same boot path users actually run in production (e.g., `cedar serve api --ud` matching the systemd `ExecStart`), not a synthetic test-only entrypoint. Tests should validate the documented production recipe directly. Confidence: 0.80
- When testing detection logic that checks generated files for specific strings (e.g., checking if a Prisma client has been generated), the test should verify that the expected strings still appear in real generated output. The goal is a regression canary that catches upstream changes to the generated output format. Confidence: 0.75
- Prefer `fs.globSync`/`fsPromises.glob` (Node 22+ built-in) over hand-rolled `readdirSync({ recursive: true })` for file pattern matching — it's simpler, more declarative, and already handles extension filtering and exclusion. Confidence: 0.65
- When warning about packages found outside expected locations, don't label them as "stray" — users may have legitimate non-Prisma uses for those packages, which means they shouldn't be removed. Confidence: 0.65

# node

- Cedar requires Node 24+. --experimental-strip-types is unflagged and not needed. Confidence: 0.90
- When forwarding a request body via `fetch()` in Cedar server code (e.g., API proxy middleware), include `duplex: 'half'` in the `RequestInit` with a `@ts-expect-error` and explanatory comment. Node 18+ fetch requires this option when streaming a body; without it, POST requests silently fail with `TypeError: RequestInit: duplex option is required when sending a body.` The DOM lib types don't yet include it. Confidence: 0.90

# Web Serve

- For SPA fallback in `cedar serve` (both Fastify and `--ud` srvx paths), use `web/dist/200.html` (unprerendered shell) when it exists, otherwise fall back to `web/dist/index.html`. Returning the prerendered `index.html` for non-prerendered routes makes the client think the page was prerendered and crashes on `prerenderLoader(name).default` when the page module isn't in `__REDWOOD__PRERENDER_PAGES`. Mirror the Fastify web adapter's logic at `packages/adapters/fastify/web/src/web.ts`. Confidence: 0.85
