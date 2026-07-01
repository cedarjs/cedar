# Code-Style

- Always document non-obvious code with comments — including why type casts are needed, and why certain workarounds exist. Confidence: 0.75
- When analyzing/debugging: distinguish facts from speculation clearly. If a claim isn't backed by direct evidence, label it as a hypothesis ("This suggests...", "One possible explanation...") rather than stating it as a conclusion. Verify claims before presenting them as facts. Confidence: 0.90
- Use regular function declarations (`function name() {}`) instead of arrow function expressions (`const name = () => {}`). Confidence: 0.85
- Avoid using try/catch as a control flow mechanism for normal code paths. Use explicit checks (e.g., checking return values, existence checks) instead. Confidence: 0.70
- Add blank lines after the closing curly brace of if statements, and generally prefer more vertical whitespace ("air") in code for readability. Confidence: 0.95
- Use `&apos;` HTML entities for apostrophes in JSX to avoid react/no-unescaped-entities lint errors. Confidence: 0.95
- Use `T[]` array type syntax, not `Array<T>`. Confidence: 0.90
- When the same pattern repeats 3+ times across files, extract it into a shared util function. Confidence: 0.75
- When explaining bug fixes or architectural changes, include concrete file:line references (e.g., `packages/foo/src/bar.ts:232`) so the user can navigate the code paths themselves. Don't stop at conceptual explanations — name the exact files and lines, especially when comparing a new/fixed path to an existing legacy path. Confidence: 0.80
- Always use separate `import type` statements for type-only imports, even when the same module also has a regular `import`. Do not mix inline `type` keyword with value imports in a single `import` statement. Confidence: 0.95
- Prefer Node.js built-in modules over external libraries when the built-in is sufficient (e.g., `spawnSync` from `node:child_process` instead of `execa`). Avoid adding unnecessary dependencies. Confidence: 0.85
- Use `spawnSync(command, args, options)` with argument arrays instead of `execSync(commandString, options)` with shell string commands for cross-platform safety — avoids shell involvement and quoting/escaping issues between Windows and Unix. Note: `execSync` only accepts 1–2 arguments (command string + options), not an args array. When switching from `execSync` to `spawnSync`, add explicit status checks (`if (result.status !== 0)`) since `spawnSync` does not throw on non-zero exit the way `execSync` does. Confidence: 0.85
- Avoid `shell: true` entirely in `spawnSync` calls — Node 24 deprecates it (`DEP0190`) even with args arrays, as Node concatenates args into a shell command string under the hood. Resolve the executable path directly (e.g., via `npm_execpath` with `.cmd` resolution for Windows) instead. Confidence: 0.85
