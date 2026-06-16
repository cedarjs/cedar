# Code-Style

- Always document non-obvious code with comments — including why type casts are needed, and why certain workarounds exist. Confidence: 0.75
- When analyzing/debugging: distinguish facts from speculation clearly. If a claim isn't backed by direct evidence, label it as a hypothesis ("This suggests...", "One possible explanation...") rather than stating it as a conclusion. Verify claims before presenting them as facts. Confidence: 0.80
- Use regular function declarations (`function name() {}`) instead of arrow function expressions (`const name = () => {}`). Confidence: 0.85
- Avoid using try/catch as a control flow mechanism for normal code paths. Use explicit checks (e.g., checking return values, existence checks) instead. Confidence: 0.70
- Add blank lines after the closing curly brace of if statements, and generally prefer more vertical whitespace ("air") in code for readability. Confidence: 0.95
- Use `&apos;` HTML entities for apostrophes in JSX to avoid react/no-unescaped-entities lint errors. Confidence: 0.95
- Use `T[]` array type syntax, not `Array<T>`. Confidence: 0.90
- When the same pattern repeats 3+ times across files, extract it into a shared util function. Confidence: 0.75
- Always use separate `import type` statements for type-only imports, even when the same module also has a regular `import`. Do not mix inline `type` keyword with value imports in a single `import` statement. Confidence: 0.95
