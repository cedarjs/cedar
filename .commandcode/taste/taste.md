# Code-Style

- Prefer `async/await` with `try/catch` over `.then()` promise chains. When refactoring a function that uses `.then()`, convert to `async function` + `try/catch` rather than keeping `.then()` style. Confidence: 0.70
- Use `oxc-parser` for AST-based code transformations instead of string manipulation. Confidence: 0.50
- Remove code that doesn't actually work instead of keeping it with comments explaining the limitation. Non-functional code with "documented limitations" is misleading — if it can't do what it claims (e.g., `%%` escaping in `cmd.exe` inline mode), remove it entirely. Confidence: 0.65

# Testing

- Testing Windows-specific code paths on Linux is reasonable when the branch logic is simple enough to exercise via platform mocking (e.g., `process.platform = 'win32'`). This catches regressions before they reach the Windows runner. The blanket rule of "never test Windows paths on Linux" oversimplifies — apply judgment: simple mocking is worth doing, complex Windows-only integration tests belong on Windows CI runners. Confidence: 0.65
- Keep tests and adapt them with proper test bodies — do not mark tests as `it.todo()` or remove them entirely when behavior changes. Write proper test bodies that validate the new behavior instead. Confidence: 0.85

# TypeScript

See [typescript/taste.md](typescript/taste.md)

# Prisma

- Use `prisma-client` provider (not `prisma-client-js`) — `prisma-client-js` is legacy Prisma v6 config and should not be used anywhere. Confidence: 0.85

# Architecture

- The gqlorm feature is intentionally TypeScript-only. It checks for `backend.ts` existence only (not `backend.js`). This is by design — unlike the graphql handler transforms (`graphql.ts`/`graphql.js`) which must support both TS and JS projects, gqlorm does not support JavaScript projects. Confidence: 0.80

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

See [cli/taste.md](cli/taste.md)

# CI / GitHub Actions

See [debugging/taste.md](debugging/taste.md)

# CLI

See [cli/taste.md](cli/taste.md)

# Debugging

See [debugging/taste.md](debugging/taste.md)

# node

- Cedar requires Node 24+. --experimental-strip-types is unflagged and not needed. Confidence: 0.90
- When forwarding a request body via `fetch()` in Cedar server code (e.g., API proxy middleware), include `duplex: 'half'` in the `RequestInit` with a `@ts-expect-error` and explanatory comment. Node 18+ fetch requires this option when streaming a body; without it, POST requests silently fail with `TypeError: RequestInit: duplex option is required when sending a body.` The DOM lib types don't yet include it. Confidence: 0.90

# Web Serve

- For SPA fallback in `cedar serve` (both Fastify and `--ud` srvx paths), use `web/dist/200.html` (unprerendered shell) when it exists, otherwise fall back to `web/dist/index.html`. Returning the prerendered `index.html` for non-prerendered routes makes the client think the page was prerendered and crashes on `prerenderLoader(name).default` when the page module isn't in `__REDWOOD__PRERENDER_PAGES`. Mirror the Fastify web adapter's logic at `packages/adapters/fastify/web/src/web.ts`. Confidence: 0.85

# esbuild

- When creating esbuild `onLoad` plugins with a `filter` regex, make the filter precise enough (include path separator) that a redundant inner path check (e.g., `args.path.endsWith(...)`) is unnecessary. A filter like `/\/graphql\.ts$/` avoids both false matches (e.g., `notgraphql.ts`) and redundant guards inside the callback. Confidence: 0.60
- Keep each esbuild plugin in its own separate file, following the pattern of `esbuild-plugin-handler-als-wrapping.ts`. Do not define multiple plugins inline in the same file where the build options live — extract each into a dedicated file with a descriptive name. Confidence: 0.70

# Process Management

- Never use `pkill` or `killall` to mass-kill processes by name (e.g., `pkill -9 node`). Only kill specific PIDs that you know are safe to terminate. Mass-killing can destroy the user's browser sessions, chat apps, and other work. Confidence: 0.85

# Testing

- When a mock/test double doesn't structurally match the expected production type (e.g., `memfs.IFs` vs `fast-glob.FileSystemAdapter`), keep the production interface strictly typed and bridge the mismatch once at the top of the test file with a single `const memfsFs = memfs as Partial<import('fast-glob').FileSystemAdapter>`. Do not widen the production interface, do not cast at every call site. Add a comment explaining why the cast is safe. Confidence: 0.80

- When testing source map correctness, decode the VLQ mappings to verify output lines map to the correct original source lines. Structural checks (existence of `mappings`, counting semicolons) are insufficient on their own — the key validation is that a position in the generated output actually maps back to the expected source line, not just that some mapping exists. Confidence: 0.65
- Use `ts-dedent` in test files to indent template literals instead of leaving them unindented or using manual indentation tricks. Confidence: 0.85

# Code Design

- Use project path helper utilities (e.g., from `@cedarjs/internal`) for path normalization instead of inline `.replaceAll('\\', '/')`. The project has shared utilities for cross-platform path handling — prefer those over one-off string replacements. Confidence: 0.70
- Do not add complexity to production code just to accommodate test scenarios. If a test requires extra production logic (e.g., absolute path handling in `isNewFile()`), prefer adapting the test instead — or removing the test — rather than adding branching logic to production code. Production code should reflect real usage, not test environment workarounds. Confidence: 0.70
- Don't add flags/parameters that are effectively ceremonial — if the flag only skips a harmless no-op (e.g., preventing a Babel plugin from running when it wouldn't match anything anyway), it's over-engineered. Following an existing convention for consistency isn't enough justification. Remove it. Confidence: 0.70
- Don't export a utility function whose name implies more safety than it actually delivers, even with JSDoc warnings. Inline such logic within the single caller instead, so other developers aren't misled into importing a function with hidden limitations. Confidence: 0.70

# CI / GitHub Actions

- When a workflow step uses `working-directory` and passes a path to the test project via an env var (e.g., `CEDAR_TEST_PROJECT_PATH`), use `${{ github.workspace }}/../path` rather than a relative path. The relative path resolves against the `working-directory`, not the workspace root. Confidence: 0.80
- When a conditional job (`if:`) has no `strategy.matrix`, GitHub creates no job entry at all if the condition is false. Jobs referencing it in `needs` then fail. Always add a dummy matrix (e.g., `strategy.matrix: { os: [ubuntu-latest] }`) so skipped jobs appear as "skipped" entries that `ci-status-check` handles correctly. Confidence: 0.90
- Do not use `inputs` expressions (e.g., `inputs.packageManager`) in job-level `if:` or `concurrency.group` of a `workflow_call` workflow that also has a `schedule` trigger. GitHub cannot resolve `inputs` at parse time for `schedule` triggers, causing the workflow to silently fail with 0 jobs. Remove `inputs` entirely or use a separate matrix approach. Confidence: 0.85
