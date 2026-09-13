# Oxlint and oxfmt migration

Plan for moving linting from ESLint to
[oxlint](https://oxc.rs/docs/guide/usage/linter.html) and formatting from
Prettier to [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html). Both tools
come from the same project (oxc) and both aim at drop-in compatibility: oxlint
runs ESLint-compatible plugins, oxfmt matches Prettier's output and migrates a
Prettier config with one command.

The migration is split by who is affected:

- **The framework repo** lints and formats its own source. This is internal,
  reversible, and can move first.
- **Cedar projects** get their lint and format setup from Cedar: the
  `@cedarjs/eslint-config` package, a Prettier config in the `create-cedar-app`
  template, `yarn cedar lint`, and generators that format the code they write
  with the project's Prettier options. Changing any of that changes what users
  install and run, so it ships in a major (v8).

The two halves share tooling but not a timeline. Nothing in this plan requires
the project-facing half to happen at all; the repo half stands on its own.

## Background: how linting and formatting work today

### The framework repo

`yarn lint` runs three ESLint invocations in parallel: `lint:fw` over
`packages/` with the root `eslint.config.mjs`, `lint:templates` inside each
`create-cedar-app` template, and `lint:ccrsca` inside `create-cedar-rsc-app`.
`yarn format:check` runs `prettier . --check`. The pre-push git hook in
`tasks/git-hooks/tasks.mts` runs both over the changed files, and CI runs both
as separate steps.

The root ESLint config uses:

| Plugin                         | What for                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `@eslint/js`                   | `recommended`                                                                           |
| `typescript-eslint`            | `recommendedTypeChecked` and `stylisticTypeChecked`, with ~25 rules tuned individually  |
| `eslint-plugin-react`          | `flat.recommended` and `jsx-runtime`                                                    |
| `eslint-plugin-react-hooks`    | `rules-of-hooks`, `exhaustive-deps`                                                     |
| `eslint-plugin-jsx-a11y`       | `recommended`                                                                           |
| `eslint-plugin-import-x`       | `order` (grouped, alphabetised, with `internal-regex`) and `no-extraneous-dependencies` |
| `eslint-plugin-jest-dom`       | `recommended`                                                                           |
| `eslint-plugin-unused-imports` | `no-unused-imports`                                                                     |
| `@cedarjs/eslint-plugin`       | `process-env-computed`                                                                  |

Type-aware rules use `parserOptions.project` pointing at `tsconfig.eslint.json`.

The root Prettier config (`prettier.config.cjs`) sets `trailingComma: 'all'`,
`semi: false`, `singleQuote: true`, `tabWidth: 2`, has a `jsonc` override for
`tsconfig.cjs.json` and `knip.jsonc`, and loads three plugins:

| Plugin                        | What for                                              |
| ----------------------------- | ----------------------------------------------------- |
| `prettier-plugin-packagejson` | Sorts `package.json` fields                           |
| `prettier-plugin-sh`          | Formats the eight tracked shell scripts               |
| `prettier-plugin-curly`       | Adds braces around single-statement `if`/`for` bodies |

Prettier also formats about 1300 Markdown files, 300 JSON files, 60 YAML files,
16 TOML files and a handful of CSS, HTML, MDX and GraphQL files.
`.prettierignore` carries a block of paths that only exist because Prettier
ignores nested `.gitignore` files; the comment there already notes that oxfmt
honours them.

### Cedar projects

`@cedarjs/eslint-config` (`packages/eslint-config/`) is a flat config that
projects import from their `eslint.config.js`. It uses the same core, React,
react-hooks, jsx-a11y, import-x and jest-dom plugins as the repo, plus:

- `eslint-plugin-prettier` with `eslint-config-prettier`, so Prettier runs as a
  lint rule and `yarn cedar lint --fix` also formats.
- All four rules from `@cedarjs/eslint-plugin`: `process-env-computed`,
  `cell-type-annotations`, `service-type-annotations` and
  `unsupported-route-components`. The last three are Cedar-specific and have
  autofixes. None use type information; they use the ESLint v9 rule API
  (`context.report`, `context.sourceCode` token lookups, fixers).

It uses no type-aware rules, and parses `.js`/`.jsx` with typescript-eslint's
parser since v7.

`yarn cedar lint` (`packages/cli/src/commands/lint.ts`) runs the `eslint` bin
that `@cedarjs/core` exposes, over `api/`, `web/` and `scripts/`.

The `create-cedar-app` template ships `prettier.config.cjs`
(`trailingComma: 'es5'`, `semi: false`, `singleQuote: true`,
`arrowParens: 'always'`, and a `printWidth: 999` override for `Routes.*`) and
`eslint.config.js`. `yarn cedar setup ui tailwindcss` adds
`prettier-plugin-tailwindcss` to the project's Prettier config.

Cedar's own code calls Prettier's Node API in 21 places to format code it
generates: `getPrettierOptions`, which exists as two copies in
`packages/cli-helpers/src/lib/index.ts` and `packages/cli/src/lib/index.ts`,
reads the project's `prettier.config.cjs` or `.mjs`, and every generator and
setup command's templates go through it; the setup helpers
`packages/cli/src/lib/configureStorybook.ts` and
`packages/cli/src/lib/merge/index.ts`, `packages/codemods/src/lib/prettify.ts`,
and `packages/internal/src/generate/{possibleTypes,trustedDocuments}.ts`. Because
of
that, `prettier` is a runtime dependency of `@cedarjs/cli`,
`@cedarjs/cli-helpers`, `@cedarjs/codemods`, `@cedarjs/internal` and
`@cedarjs/eslint-config`, and every Cedar project installs it.

## What oxlint and oxfmt provide (verified September 2026)

### oxlint

- Built-in plugins: `eslint`, `typescript`, `unicorn` and `oxc` on by default;
  `react`, `react-perf`, `import`, `jsx-a11y`, `jest`, `vitest`, `promise`,
  `node`, `nextjs`, `jsdoc` and `vue` opt-in. Most rules from the respective
  `recommended` configs are implemented, including `react/exhaustive-deps` and
  `import/no-extraneous-dependencies`.
- **No `import/order`.** The project has decided not to implement it and points
  at oxfmt's import sorting instead, or at `eslint-plugin-perfectionist` loaded
  as a JS plugin.
- **No jest-dom, unused-imports or prettier plugins** built in.
- **JS plugins** (`jsPlugins` in `.oxlintrc.json`) load ESLint v9-compatible
  plugins from npm or local files. Supports `context.report`, fixes, options,
  selectors, `sourceCode` text and token access, scope analysis and
  `node.parent`. Labelled **alpha**. No type-aware rules through this path.
- **Type-aware linting** through the separate `oxlint-tsgolint` package, enabled
  with `--type-aware` or `options.typeAware: true` in the config. Declared
  stable on 22 July 2026; tsgolint v7 tracks TypeScript 7.0.x and implements 59
  of typescript-eslint's 61 type-aware rules. Requires TypeScript 7
  (typescript-go). The docs note high memory use on very large codebases.
- `// oxlint-disable` comments and IDE support exist.

### oxfmt

- **Beta.** Passes 100% of Prettier's JavaScript and TypeScript conformance
  tests; differences are treated as bugs. Compatible with Prettier 3.8 options,
  except `experimentalTernaries` and the `prettier` field in `package.json`.
- Formats JS, JSX, TS, TSX, JSON, JSONC, JSON5, YAML, TOML, HTML, CSS, SCSS,
  Less, Markdown, MDX, GraphQL, Vue, Svelte and embedded code in template
  literals. **Not shell scripts.**
- **No plugin system.** Built-in replacements: `sortPackageJson` (default on),
  `sortImports` and `sortTailwindcss` (default off), `jsdoc`.
- Honours nested `.gitignore` files; `.prettierignore` becomes `ignorePatterns`.
- `printWidth` defaults to 100 (Prettier: 80).
- `oxfmt --migrate prettier` converts a Prettier config.
- Node API: `format(filename, code, options)` returns `{ code }`, formats in
  memory, options follow Prettier's names.

## Decisions

### The repo moves first, on its own

Nothing users see depends on how the framework repo lints itself. The repo half
is done and verified before the project half starts, and stays done even if the
project half is postponed.

### Keep ESLint for type-aware rules until the repo is on TypeScript 7

The root config extends the type-checked presets but turns most of their
headline rules off with a TODO to revisit (`no-floating-promises`,
`no-misused-promises`, the `no-unsafe-*` family, `require-await` and others).
The rules that stay on still need type information and still catch real bugs:
`await-thenable`, `no-unnecessary-type-assertion`, `only-throw-error`,
`no-for-in-array`, `no-implied-eval` and the type-checked stylistic rules.
`await-thenable` in particular catches an `await` on a value whose type is not
a promise, which is the kind of mismatch a dependency major introduces when a
function turns synchronous or asynchronous. tsgolint is stable and covers these
rules, but it is built on TypeScript 7 and the repo is on TypeScript 5.9. The
repo runs oxlint for everything else and a much smaller ESLint config with only
the type-checked presets until the TypeScript upgrade lands. Two linters is a
temporary state with a defined exit.

### `import/order` moves to the formatter

Import grouping stops being a lint rule and becomes oxfmt's `sortImports`. That
matches where the oxc project wants it and removes the last plugin the repo
needs from the import-x family. The grouping oxfmt produces must reproduce the
current order (builtins, external, `@cedarjs/*` internal, relative) closely
enough that the one-time reformat is the only churn.

### `prettier-plugin-curly` becomes a lint rule

Adding braces is a code transform, not formatting. Oxlint's `curly` rule with
autofix replaces the plugin. This is a one-time reformat of the tree.

### Shell scripts stop being formatted

Eight `.sh` files do not justify keeping Prettier installed for
`prettier-plugin-sh`. They are excluded from formatting checks.

### The project half ships in v8, together

`@cedarjs/eslint-config`, the `create-cedar-app` template, `yarn cedar lint` and
the generator formatting change in one release, so a project migrates its lint
and format setup once. This is a breaking change for every project: a new config
file, removal of `eslint-plugin-prettier`, and different tooling behind
`yarn cedar lint`.

### Cedar's rules ship as an oxlint JS plugin

`@cedarjs/eslint-plugin` already uses only the ESLint v9 rule API, so it loads
unchanged through `jsPlugins`. The package keeps its name and can still be used
from ESLint. The JS plugin layer is alpha; the v8 decision below on whether to
ship it is gated on its status at the time.

### Generators format with oxfmt, reading the project's oxfmt config

The 21 Prettier call sites move to oxfmt's `format()`. The two copies of
`getPrettierOptions` become one `getFormatOptions` in `@cedarjs/cli-helpers`
that reads `.oxfmtrc.json`. For a project that still has only a Prettier
config, it translates the options the way `oxfmt --migrate prettier` does:
supported options map one to one, `prettier-plugin-tailwindcss` maps to
`sortTailwindcss`, and any other plugin produces a warning naming it and is
skipped. Generated output therefore depends only on options oxfmt understands,
and never on a Prettier plugin. Prettier leaves the dependency list of every
shipped package.

## Target design

### The framework repo

- `.oxlintrc.json` at the root with the `react`, `jsx-a11y`, `import`, `vitest`
  and `typescript` plugins enabled, `jsPlugins` for `@cedarjs/eslint-plugin`,
  `eslint-plugin-jest-dom` and `eslint-plugin-unused-imports`, and per-directory
  overrides mirroring the current config blocks (tests, `.cjs` files, templates,
  fixtures).
- `eslint.config.mjs` reduced to the type-checked presets only, run as
  `lint:types` until tsgolint replaces it.
- `.oxfmtrc.json` generated by `oxfmt --migrate prettier`, then edited:
  `printWidth: 80`, `sortImports` configured to match the current groups,
  `sortPackageJson` left on, the `jsonc`/`trailingComma: 'none'` override kept,
  `ignorePatterns` reduced to `**/dist`, `packages/testing/config`,
  `/__fixtures__`, `**/*.sh` and `/packages/create-cedar-rsc-app`. The last one
  keeps the rsc-app's own Prettier setup authoritative, since that package is
  outside this plan; the root oxlint run gets the same exclusion.
- `package.json` scripts: `lint` runs `oxlint` plus `lint:types`; `format` and
  `format:check` run `oxfmt` and `oxfmt --check`; `lint:templates` unchanged
  until phase 4 replaces the template configs; `lint:ccrsca` unchanged, since
  `create-cedar-rsc-app` is outside this plan.
- `tasks/git-hooks/tasks.mts` runs `oxlint` and `oxfmt` over the changed files
  instead of `eslint` and `prettier`.
- `.github/workflows/ci.yml` lint and format steps call the new scripts.
- `.prettierignore`, `prettier.config.cjs`, `prettier-plugin-*`,
  `eslint-plugin-import-x`, `eslint-plugin-react*` and `eslint-plugin-jsx-a11y`
  removed from the root `package.json`. `eslint-plugin-unused-imports` stays as
  long as `.oxlintrc.json` loads it (see phase 2 step 2). `eslint`, `@eslint/js`
  and `typescript-eslint` stay for `lint:types`.

### Cedar projects (v8)

- `@cedarjs/eslint-config` is replaced by an oxlint config package (working name
  `@cedarjs/oxlint-config`) that exports a config object. Projects import it
  from an `oxlint.config.ts`; oxlint's JSON `extends` only resolves file paths,
  not package names, so the JSON form is not used for the shared config. It
  enables the same plugins and `jsPlugins: ["@cedarjs/eslint-plugin"]`.
- The template ships `oxlint.config.ts` and `.oxfmtrc.json` instead of
  `eslint.config.js` and `prettier.config.cjs`. `printWidth: 80`,
  `trailingComma: "es5"`, the `Routes.*` override, `sortImports` on with Cedar's
  groups (`src/`, `$api/`, `@cedarjs/*`).
- `yarn cedar lint` runs `oxlint`; `yarn cedar lint --fix` runs `oxlint --fix`
  followed by `oxfmt`, so `--fix` keeps formatting the way
  `eslint-plugin-prettier` did. A new `yarn cedar format` runs `oxfmt`.
- `yarn cedar setup ui tailwindcss` turns on `sortTailwindcss` in
  `.oxfmtrc.json` instead of installing `prettier-plugin-tailwindcss`.
- `@cedarjs/core` exposes `oxlint` and `oxfmt` bins instead of `eslint`.
- `getFormatOptions` in `@cedarjs/cli-helpers` reads `.oxfmtrc.json`; the
  generator, setup, codemod and `internal/generate` call sites use oxfmt's
  `format()`.
- An upgrade script for 8.x converts `prettier.config.cjs` to `.oxfmtrc.json`
  (reusing `oxfmt --migrate prettier`), writes an `oxlint.config.ts` importing
  the Cedar config, removes `eslint.config.js`, `eslint-plugin-prettier` and
  `prettier-plugin-tailwindcss` from the project, and reports anything it could
  not translate (custom ESLint rules or plugins in the project's own config).

## Implementation steps

### Phase 1 — Repo formatting on oxfmt

1. Add `oxfmt` as a root dev dependency. Run `oxfmt --migrate prettier`, then
   set `printWidth: 80` and the ignore patterns.
2. Run `oxfmt` over the tree and check the diff. It should be empty for JS/TS;
   review the Markdown, YAML, TOML and CSS diffs by hand. `package.json` files
   will change field order, because `sortPackageJson` orders fields differently
   from `prettier-plugin-packagejson`; review that once and accept it. Any other
   change that is not a pure whitespace/quote-style change is a bug to report
   upstream before continuing.
3. Turn on `sortImports` with groups that reproduce the current
   `import-x/order` config. Run again; the diff is the one-time import reorder.
   Commit separately.
4. Enable oxlint's `curly` rule with `--fix` in the same PR to replace
   `prettier-plugin-curly`. This has to happen before step 5: the plugin needs
   Prettier to run, so once Prettier is gone nothing adds braces to new code.
   (Formatting with oxfmt does not remove existing braces, so the tree does not
   regress in between.)
5. Switch the `format` scripts, the git hook and CI. Remove Prettier and its
   plugins from the root `package.json`. Delete `.prettierignore` and
   `prettier.config.cjs`.
6. `packages/babel-config/src/plugins/prettier.config.cjs` exists only so that
   `babel-plugin-tester` formats snapshot output with Prettier 2. It stays until
   that dev dependency is replaced; note it in the PR.

Exit criteria: `yarn format:check` passes with oxfmt only, CI green, and the
pre-push hook runs in under the time the Prettier hook took.

### Phase 2 — Repo linting on oxlint, ESLint kept for type-aware rules

1. Add `oxlint` as a root dev dependency. Write `.oxlintrc.json` reproducing the
   current config block by block: recommended sets, then every rule the current
   config turns on or off individually (the ~25 `@typescript-eslint` entries,
   `react/prop-types` off, `react/display-name` off, and so on).
2. Load `@cedarjs/eslint-plugin`, `eslint-plugin-jest-dom` and
   `eslint-plugin-unused-imports` through `jsPlugins`. If `unused-imports` is
   fully covered by oxlint's `no-unused-vars` autofix, drop it instead.
3. Remove `import-x/order` (now handled by oxfmt) and
   `import-x/no-extraneous-dependencies` (now
   `import/no-extraneous-dependencies`).
4. Run oxlint over `packages/`. Triage every new finding: a rule that fires
   where ESLint did not is either a stricter default (adjust the config) or an
   oxlint bug (report, disable the rule, note it in the config with the issue
   link).
5. Cut `eslint.config.mjs` down to `recommendedTypeChecked` and
   `stylisticTypeChecked` with the existing rule adjustments, and only the
   plugins those need. Rename the script to `lint:types`.
6. `yarn lint` runs `oxlint` and `lint:types`. Update the git hook and CI.
   `lint:templates` keeps running ESLint until phase 4 replaces the template
   configs. `lint:ccrsca` keeps running ESLint indefinitely; the
   `create-cedar-rsc-app` package is outside this plan.

Exit criteria: `yarn lint` green, no rule from the old config silently lost
(diff the effective rule lists), and every plugin loaded through `jsPlugins`
verified with a fixture file that must produce that plugin's diagnostic. A
plugin that fails the fixture check keeps its rules in the ESLint config until
it passes. oxlint's wall-clock time recorded in the PR.

### Phase 3 — Type-aware rules on tsgolint

Gated on: the repo on TypeScript 7, and the two type-aware rules tsgolint
does not implement being ones the repo does not use.

1. Add `oxlint-tsgolint`, set `options.typeAware: true` in the root
   `.oxlintrc.json`, port the type-checked rule adjustments.
2. Delete `eslint.config.mjs`, `tsconfig.eslint.json`, `lint:types`, and the
   remaining ESLint dev dependencies at the root.

Exit criteria, checked before step 2: with `typeAware` on, each type-checked
rule the repo keeps enabled reports the same finding as `lint:types` on a
fixture that violates it.

### Phase 4 — Cedar projects (v8)

Gated on: oxlint JS plugins out of alpha (or an explicit decision to ship on
alpha), oxfmt stable.

1. Create the oxlint config package and the template files. Lint the
   `create-cedar-app` templates with them; that replaces `lint:templates`.
2. Port `yarn cedar lint`, add `yarn cedar format`, swap the `@cedarjs/core`
   bins.
3. Port `getPrettierOptions` and the 21 `format()` call sites. The generator
   snapshot tests in `packages/cli` will need one regeneration; the diff must be
   empty or import-order only.
4. Update `setup ui tailwindcss`, and any other setup command that edits the
   Prettier config, to edit `.oxfmtrc.json`.
5. Remove `prettier` and `eslint` from every shipped package's dependencies.
   Confirm with `yarn why` in a freshly created project that neither installs.
6. Write the 8.x upgrade script and the v8 upgrade guide section. Test it on a
   v7 project with a custom rule in `eslint.config.js` to verify the "could not
   translate" report.
7. Docs: `docs/docs/cli-commands.md` for `lint` and `format`, the ESLint
   references in `docs/docs/` (search for `eslint` and `prettier`), and the
   `cell-type-annotations` docs that show how to enable the rule.

## Open questions

- **Import groups.** Whether oxfmt's `sortImports` can express the current
  `import-x/order` config exactly (builtin, external, `@cedarjs/*` as internal,
  parent, sibling, index, with blank lines between groups and alphabetised
  within). If not, decide between accepting oxfmt's grouping repo-wide or
  loading `eslint-plugin-perfectionist` as a JS plugin.
- **`unused-imports`.** Whether oxlint's `no-unused-vars` fixer removes whole
  unused import declarations the way the plugin does. Decides step 2.2.
- **jest-dom through JS plugins.** The plugin is not in oxlint's conformance
  list. Needs a trial run over `packages/` before phase 2 commits to it.
- **`react/exhaustive-deps` differences.** oxlint has open issues where it
  reports differently from `eslint-plugin-react-hooks`. If the repo hits one,
  decide per case between a code change and a disable comment.
- **Shipping on alpha.** If JS plugins are still alpha when v8 is being planned,
  choose between waiting, shipping the Cedar rules through ESLint alongside
  oxlint (two linters in every project), or dropping the three Cedar-specific
  rules from the default config and offering them as opt-in.
- **`babel-plugin-tester` and Prettier 2.** Phase 1 step 6. Replacing the dev
  dependency is out of scope here but is what lets the last Prettier config in
  the repo go.
- **VS Code.** The template's `.vscode/extensions.json` recommends the ESLint
  extension; v8 switches it to the oxc extension. Confirm the extension lints
  and formats on save with the config files in a Yarn workspace root.

## Files affected

Phase 1 and 2 (repo):

- `package.json` (scripts and dev dependencies), `yarn.lock`
- `.oxlintrc.json`, `.oxfmtrc.json` (new)
- `eslint.config.mjs` (reduced), `tsconfig.eslint.json` (kept for phase 2)
- `prettier.config.cjs`, `.prettierignore` (deleted)
- `tasks/git-hooks/tasks.mts` and its tests
- `.github/workflows/ci.yml`
- Every file touched by the one-time import reorder and brace insertion

Phase 4 (projects):

- `packages/eslint-config/` (replaced), `packages/eslint-plugin/` (loaded as a
  JS plugin, package name unchanged)
- `packages/core/package.json` (bins), `packages/core/src/bins/`
- `packages/cli/src/commands/lint.ts`, new `format.ts`
- `packages/cli/src/lib/index.ts` and `packages/cli-helpers/src/lib/index.ts`
  (the two `getPrettierOptions` copies, merged into `getFormatOptions`), and
  the setup handlers under `packages/cli/src/commands/setup/` that call
  `format`
- `packages/cli/src/lib/configureStorybook.ts` (Mantine, Chakra UI and i18n
  setup) and `packages/cli/src/lib/merge/index.ts`
- `packages/cli/src/testUtils/index.ts` and
  `packages/codemods/src/testUtils/index.ts`, which format expected output in
  tests
- `packages/codemods/src/lib/prettify.ts`,
  `packages/internal/src/generate/possibleTypes.ts`,
  `packages/internal/src/generate/trustedDocuments.ts`
- `packages/cli/src/commands/setup/ui/libraries/tailwindcssHandler.ts`
- `packages/create-cedar-app/templates/*/{eslint.config.js,prettier.config.cjs,package.json,.vscode/extensions.json}`
- `upgrade-scripts/8.x.ts`, `upgrade-scripts/manifest.json`
- `docs/docs/cli-commands.md`, `docs/docs/upgrade-guides/cedar-v8.md`, and the
  pages that mention ESLint or Prettier

## What this does NOT cover

- Replacing Prettier inside `babel-plugin-tester` (phase 1 step 6).
- Biome. It was not evaluated; oxc was chosen because its linter runs ESLint
  plugins unchanged and its formatter targets exact Prettier output, which is
  what lets the Cedar rules and the generator formatting move without a rewrite.
- Type-aware linting in user projects. `@cedarjs/eslint-config` has none today
  and v8 adds none.
- The `create-cedar-rsc-app` package, which has its own ESLint and Prettier
  setup and moves on its own schedule.
