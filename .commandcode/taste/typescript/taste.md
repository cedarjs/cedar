# TypeScript

- Avoid `as any` — prefer proper types, then `unknown`, then type casts. Use `as any` only as absolute last resort and always document with a code comment why it was necessary. Confidence: 0.95
- Do not use `as unknown as SomeType` to force a type cast — prefer proper type guards, narrowing, or union discrimination instead. `as unknown as` bypasses the type system entirely and hides real type errors. Confidence: 0.75
- Avoid `as` type casting in general. If a type cast is unavoidable, try a generic on `reduce`/similar first; if the cast must stay, add a short comment explaining why. Confidence: 0.90
- When JS→TS converting CLI command files: use `import type { Argv } from 'yargs'`, add type annotations to builders, keep handler signatures as narrow as possible. Confidence: 0.60
- Prefer `interface` over `type` for object type declarations. Confidence: 0.70
- Avoid barrel/index.ts export files; use package.json exports map for entrypoints instead. Confidence: 0.70
- When fixing type errors caused by callers passing `undefined` to a util: prefer making the caller consistent (e.g., default at destructure like `typescript = false`) over loosening the util's signature with `?`. Keep util types strict; push defaults to caller sites to match the rest of the codebase. Confidence: 0.80
- Prefer `.mts` (TypeScript) over `.mjs` (JavaScript) for Node scripts — since Node 24+ runs TypeScript natively without flags (type-stripping only; no type checking at runtime), `.mts` files provide type annotation and editor/IDE type-inference benefits. Run `tsc --noEmit` separately to enforce type safety. Confidence: 0.70
