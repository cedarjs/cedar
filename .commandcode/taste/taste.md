# TypeScript

- Avoid `as any` — prefer proper types, then `unknown`, then type casts. Use `as any` only as absolute last resort and always document with a code comment why it was necessary. Confidence: 0.95
- Avoid `as` type casting in general. If a type cast is unavoidable, try a generic on `reduce`/similar first; if the cast must stay, add a short comment explaining why. Confidence: 0.90
- When JS→TS converting CLI command files: use `import type { Argv } from 'yargs'`, add type annotations to builders, keep handler signatures as narrow as possible. Confidence: 0.60
- Prefer `interface` over `type` for object type declarations. Confidence: 0.70
- Avoid barrel/index.ts export files; use package.json exports map for entrypoints instead. Confidence: 0.70
- When fixing type errors caused by callers passing `undefined` to a util: prefer making the caller consistent (e.g., default at destructure like `typescript = false`) over loosening the util's signature with `?`. Keep util types strict; push defaults to caller sites to match the rest of the codebase. Confidence: 0.80

# Prisma

- Use `prisma-client` provider (not `prisma-client-js`) — `prisma-client-js` is legacy Prisma v6 config and should not be used anywhere. Confidence: 0.85

# Architecture

- Cedar only supports Apollo Client for GraphQL. Remove abstractions/wrappers that suggest alternative GraphQL clients are supported. Confidence: 0.75
- Cedar owns zero deployment adapters. The framework's only UD responsibility is calling `addEntry()` from `@universal-deploy/store` with WinterTC-compatible handler paths. All provider-specific adapter logic (Node, Netlify, Vercel, Cloudflare) belongs to Universal Deploy adapters, not Cedar. Confidence: 0.85

# Workflow

- After making code changes, verify by running: prettier, eslint, unit tests, and tsc on changed files before considering the change complete. Confidence: 0.80
- Add tests one at a time, verifying each passes before adding the next test. Confidence: 0.70
- Maintain backwards compatibility in semver minor releases; no mandatory breaking changes. Confidence: 0.75

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

# Architecture

- Neon Postgres (`@prisma/adapter-pg`) does not require ESM at runtime. The `--esm` requirement in `create-cedar-app`'s `handle-args.ts` is a scaffolding-time guard only. Do not force CJS→ESM conversion when adding Neon to existing projects. Confidence: 0.85

# CLI

- Avoid using `rg` (ripgrep) in CLI tools that run on user machines — it's not guaranteed to be installed, especially on Windows. Use Node.js built-in `fs` methods or other universally available approaches instead. Confidence: 0.70

# Debugging

- When reproducing bugs, validate against realistic production code paths (e.g., curl against a running server) rather than synthetic/unit-level demonstrations that load modules in isolation. The repro should prove the bug happens in real usage. Confidence: 0.75
- When testing detection logic that checks generated files for specific strings (e.g., checking if a Prisma client has been generated), the test should verify that the expected strings still appear in real generated output. The goal is a regression canary that catches upstream changes to the generated output format. Confidence: 0.75
- Prefer `fs.globSync`/`fsPromises.glob` (Node 22+ built-in) over hand-rolled `readdirSync({ recursive: true })` for file pattern matching — it's simpler, more declarative, and already handles extension filtering and exclusion. Confidence: 0.65
- When warning about packages found outside expected locations, don't label them as "stray" — users may have legitimate non-Prisma uses for those packages, which means they shouldn't be removed. Confidence: 0.65

# node

- Cedar requires Node 24+. --experimental-strip-types is unflagged and not needed. Confidence: 0.90
