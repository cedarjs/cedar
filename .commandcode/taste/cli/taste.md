# CLI

- Avoid using `rg` (ripgrep) in CLI tools that run on user machines — it's not guaranteed to be installed, especially on Windows. Use Node.js built-in `fs` methods or other universally available approaches instead. Confidence: 0.70
- `getPackageManager()` detects PM primarily via `npm_config_user_agent` env var (set automatically by whichever PM runs the command), then falls back to lockfile detection. The `packageManager` field in `package.json` is NOT read by `getPackageManager()`. Confidence: 0.95
- npm does not support the `workspace:*` protocol. When running `npm install` on a project that has `workspace:*` deps, replace them with `file:` references first. pnpm and yarn both support `workspace:*` natively. Confidence: 0.90
- pnpm's `pnpm install` checks the `packageManager` field in `package.json` and refuses to run if it specifies a different PM (e.g., `yarn@4.14.1`). Update it to `pnpm` before running install. Confidence: 0.90
- For running package.json scripts, use `runScript`/`runScriptSync` from `@cedarjs/cli-helpers/packageManager/exec` (which adds `npm run` prefix automatically for npm). Do NOT use `execa(getPackageManager(), [scriptName])` — npm requires `npm run`, not bare `npm`. Confidence: 0.85
- For shell-piped commands requiring a PM binary prefix (e.g., `cedar-jobs | cedar-log-formatter`), use `formatRunBinCommand` from `@cedarjs/cli-helpers/packageManager/display` rather than inlining PM-specific prefix logic (e.g., `pm === 'npm' ? 'npx' : pm`). Confidence: 0.90
