# Plan: Default API Proxy Path to `.api/functions`

## Summary

Switch Cedar's default frontend-to-backend proxy path from `/.redwood/functions`
to `/.api/functions`, removing the framework name from the URL. Deployment
provider setup commands will read the user's configured `apiUrl` instead of
hardcoding a path.

This change is **opt-in for existing apps**. Only newly created apps get
`/.api/functions` as the default. Existing apps keep whatever `apiUrl` they
already have.

## Goals

- New Cedar apps default to `apiUrl = "/.api/functions"` in their `cedar.toml`
- Existing apps are untouched — no automatic migration
- Deployment setup commands (`setup deploy <provider>`) read `apiUrl` from the
  user's config instead of hardcoding `/.redwood/functions`
- The framework respects whatever `apiUrl` the user configures
- Upgrade docs explain how existing apps can opt in to `/.api/functions`

## Non-Goals

- Changing the generated data directory (`.redwood/` vs `.cedar/`) — already
  handled separately
- Removing support for `/.redwood/functions` — it continues to work
- Forcing existing apps to migrate
- Changing how `apiGraphQLUrl` works

## Current State

### Default Config

`packages/project-config/src/config.ts` hardcodes the fallback:

```ts
export const DEFAULT_CONFIG: Config = {
  web: {
    // ...
    apiUrl: '/.redwood/functions',
    // ...
  },
}
```

### Templates

All four `create-cedar-app` templates set:

```toml
[web]
  apiUrl = "/.redwood/functions"
```

### Deployment Provider Hardcoding

**Render handler** (`packages/cli/src/commands/setup/deploy/providers/renderHandler.js`):

```js
updateApiURLTask('/.redwood/functions'),
```

**Flightcontrol handler** (`packages/cli/src/commands/setup/deploy/providers/flightcontrolHandler.js`):

```js
REDWOOD_API_URL=/.redwood/functions
```

**Render template** (`packages/cli/src/commands/setup/deploy/templates/render.js`):

```js
source: /.redwood/functions/*
```

**Netlify** and **Vercel** already use their own paths (`/.netlify/functions`,
`/api`) and are unaffected.

### Where the Path Flows

| Location                                              | Uses                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| `packages/project-config/src/config.ts`               | Hardcoded default                          |
| `packages/vite/src/lib/getMergedConfig.ts`            | `cedarConfig.web.apiUrl`                   |
| `packages/vite/src/runFeServer.ts`                    | `rwConfig.web.apiUrl`                      |
| `packages/vite/src/rsc/rscStudioHandlers.ts`          | Hardcoded `/.redwood/functions/rsc-flight` |
| `packages/adapters/fastify/web/src/resolveOptions.ts` | `getConfig().web.apiUrl`                   |
| `packages/project-config/src/envVarDefinitions.ts`    | `rwConfig.web.apiUrl`                      |

## Guiding Principles

### 1. Existing Apps Are Frozen

No automatic migration. The framework must not rewrite a user's `cedar.toml` or
`redwood.toml` on upgrade. Opt-in is a deliberate user action.

### 2. Providers Respect User Config

Deployment setup commands must read the existing `apiUrl` value and use it.
Hardcoding a path in a provider setup command is a bug, not a convenience.

### 3. The Default Is for New Apps Only

`create-cedar-app` templates ship with the new default. The framework fallback
(`DEFAULT_CONFIG`) also returns the new default so that apps without an explicit
`apiUrl` get `/.api/functions`.

### 4. One Source of Truth

The user's `cedar.toml` / `redwood.toml` is the single source of truth for the
proxy path. Framework code, deployment templates, and documentation all derive
from that value.

## Implementation

### Phase 1: Change the Default

**Effort: S (Small)**

#### 1.1 Update `DEFAULT_CONFIG`

`packages/project-config/src/config.ts`:

```ts
export const DEFAULT_CONFIG: Config = {
  web: {
    // ...
    apiUrl: '/.api/functions',
    // ...
  },
}
```

#### 1.2 Update all `create-cedar-app` templates

Change `apiUrl` in the `[web]` section of every template's `cedar.toml`:

- `packages/create-cedar-app/templates/ts/cedar.toml`
- `packages/create-cedar-app/templates/js/cedar.toml`
- `packages/create-cedar-app/templates/esm-ts/cedar.toml`
- `packages/create-cedar-app/templates/esm-js/cedar.toml`

```toml
[web]
  apiUrl = "/.api/functions"
```

#### 1.3 Update template tests

`packages/create-cedar-app/tests/templates.test.ts` asserts on generated TOML
content. Update expectations.

#### Exit Criteria

- `yarn create-cedar-app` produces apps with `apiUrl = "/.api/functions"`
- Apps without an explicit `apiUrl` in TOML get `/.api/functions` as the
  fallback

---

### Phase 2: Make Deployment Providers Config-Driven

**Effort: S (Small)**

Replace hardcoded `/.redwood/functions` in deployment setup commands with
config-derived values.

The key insight: deployment setup should **not** force-update the user's
`apiUrl` in TOML. The provider's routing rules should match whatever the user
already has configured.

#### 2.1 Add a helper to read the user's `apiUrl`

If one does not already exist near `updateApiURLTask`, add:

```js
import { getConfig } from '@cedarjs/project-config'

export function getUserApiUrl() {
  return getConfig().web.apiUrl
}
```

#### 2.2 Update Render handler and template

**Remove** `updateApiURLTask` from the task list in
`packages/cli/src/commands/setup/deploy/providers/renderHandler.js`.
The user's TOML is the source of truth and should not be mutated.

Update the Render template in
`packages/cli/src/commands/setup/deploy/templates/render.js`:

```js
import { getUserApiUrl } from '../helpers/index.js'

// ...
source: `${getUserApiUrl()}/*`,
```

#### 2.3 Update Flightcontrol handler and `.env.defaults` writer

**Remove** `updateApiURLTask` from the task list in
`packages/cli/src/commands/setup/deploy/providers/flightcontrolHandler.js`.
The TOML already uses `${REDWOOD_API_URL}`, which is fine.

Update `addToDotEnvDefaultTask` to use the user's `apiUrl` instead of
hardcoding `/.redwood/functions`:

```js
const addToDotEnvDefaultTask = () => {
  const apiUrl = getUserApiUrl()
  return {
    // ...
    task: async (_ctx) => {
      const env = path.resolve(getPaths().base, '.env.defaults')
      const line = `\n\nREDWOOD_API_URL=${apiUrl}\n`
      fs.appendFileSync(env, line)
    },
  }
}
```

#### 2.4 Audit all other provider templates

Search for any remaining `/.redwood/functions` hardcoding in:

- `packages/cli/src/commands/setup/deploy/**/*`
- `packages/cli/src/commands/setup/deploy/templates/**/*`

#### Exit Criteria

- `yarn cedar setup deploy render` generates a `render.yaml` whose `source`
  matches the user's `apiUrl` without touching `cedar.toml`
- `yarn cedar setup deploy flightcontrol` writes the user's `apiUrl` to
  `.env.defaults` without touching `cedar.toml`
- No deployment setup command hardcodes `/.redwood/functions`

---

### Phase 3: Framework Code Audit

**Effort: S (Small)**

#### 3.1 Fix hardcoded references in source code

`packages/vite/src/rsc/rscStudioHandlers.ts` hardcodes:

```ts
path: '/.redwood/functions/rsc-flight',
```

This should derive from `getConfig().web.apiUrl`:

```ts
const apiUrl = getConfig().web.apiUrl.replace(/\/$/, '')
path: `${apiUrl}/rsc-flight`,
```

#### 3.2 Audit comments and error messages

Search for `.redwood/functions` in framework source (not tests/docs) and update
comments, error messages, and help text that mention the old path.

#### 3.3 Keep test fixtures on old path (or parameterize)

Test fixtures that explicitly test `/.redwood/functions` behavior should
continue to work. Either:

- Leave the fixture config as `/.redwood/functions` to verify backward compat, or
- Parameterize the test so it runs with both `/.redwood/functions` and
  `/.api/functions`

#### Exit Criteria

- No framework source code hardcodes `/.redwood/functions` except for backward-
  compatibility tests
- `rsc-flight` path is derived from config

---

### Phase 4: Rebuild Test Project Fixture

**Effort: XS (Extra Small)**

After Phases 1–3 land, run `yarn rebuild-test-project-fixture` so the fixture
apps have `apiUrl = "/.api/functions"`.

This ensures CI, e2e tests, and the fixture snapshot match the new default.

#### Exit Criteria

- `__fixtures__/test-project` has `apiUrl = "/.api/functions"`
- `__fixtures__/test-project-esm` has `apiUrl = "/.api/functions"`
- `__fixtures__/test-project-live` has `apiUrl = "/.api/functions"`

---

### Phase 5: Documentation and Upgrade Guide

**Effort: S (Small)**

#### 5.1 Upgrade guide

Add a section to `docs/docs/upgrade-guides/*.md`:

````md
## API Proxy Path (Optional)

New Cedar apps now default to `apiUrl = "/.api/functions"` instead of
`apiUrl = "/.redwood/functions"`. Existing apps are **not** migrated
automatically.

To opt in, change your `cedar.toml` (or `redwood.toml`):

```toml
[web]
  apiUrl = "/.api/functions"
```
````

If you have serverless functions deployed behind a specific path
(e.g., Netlify's `/.netlify/functions`), keep your current `apiUrl`.

````

#### 5.2 Deployment provider docs

Update deployment setup docs to note that Cedar reads `apiUrl` from the user's
config. No manual template editing should be required.

#### 5.3 Changelog

Document the change for the next release.

#### Exit Criteria

- Upgrade guide explains the opt-in nature of the change
- Deployment docs mention config-driven `apiUrl`

---

## Migration Path for Existing Apps

No automatic migration. Existing apps keep their current `apiUrl` forever unless
the developer manually changes it.

### Manual Opt-In Steps

1. Open `cedar.toml` (or `redwood.toml`)
2. Change `apiUrl` from `"/.redwood/functions"` to `"/.api/functions"`
3. If using serverless functions, update the function path in the provider
dashboard (e.g., Netlify, Vercel) to match
4. Re-deploy

### Codemod (Optional)

If demand is high, a simple codemod can be provided later:

```ts
// codemod: change-api-url-to-dot-api
// Replaces apiUrl = "/.redwood/functions" with apiUrl = "/.api/functions"
````

This is low priority because the change is one line in TOML.

## Risks

- **Deployment provider templates break** if the provider expects a specific path
  and the user configures something unexpected. Mitigation: providers that need
  a specific path (Netlify, Vercel) already use their own paths; Cedar should
  not override them.
- **Existing tutorials/docs reference `/.redwood/functions`** and confuse new
  users who see `/.api/functions` in their app. Mitigation: update docs promptly.
- **Third-party integrations** (e.g., custom middleware, external API clients)
  may hardcode `/.redwood/functions`. Those are outside Cedar's control.
- **Flightcontrol/Render users** who previously ran setup deploy and now rerun
  it may get a different path. Mitigation: setup deploy should be idempotent
  and use current config.

## Acceptance Criteria

- [ ] `DEFAULT_CONFIG.apiUrl` is `/.api/functions`
- [ ] All `create-cedar-app` templates ship with `apiUrl = "/.api/functions"`
- [ ] No deployment setup command hardcodes `/.redwood/functions`
- [ ] `rscStudioHandlers.ts` derives the flight endpoint from config
- [ ] Test project fixtures are rebuilt with `/.api/functions`
- [ ] Upgrade docs explain opt-in migration
- [ ] `yarn test` and `yarn test:types` pass
- [ ] `yarn rebuild-test-project-fixture` passes
