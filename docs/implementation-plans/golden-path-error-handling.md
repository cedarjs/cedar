# GraphQL Spec Compliance: Error Hardening & Error Masking

## Summary

This document assesses Cedar's current compliance with the **Error Hardening /
Error Masking** GraphQL best-practice specification and outlines the work
required to reach full compliance.

---

## Spec goals

- Return stable, safe error responses to clients by default.
- Keep full internal details in server-side logs only.
- Provide a `SafeError` escape hatch for intentionally client-visible errors.
- Give each masked error a unique identifier so individual instances can be
  correlated to server logs.
- Define and enforce a consistent error shape across all services.

---

## Current state

Cedar's error handling is in good shape. Masking is on by default and the
layered design — Yoga masking + `RedwoodError` allowlist + structured logging —
covers most of the spec.

### What is already implemented

**Masking enabled by default**

GraphQL Yoga's `maskedErrors` is enabled unconditionally in
`createGraphQLYoga.ts`. Unexpected plain `Error` instances are replaced with a
stable, generic string before the response leaves the server:

```ts
// packages/graphql-server/src/createGraphQLYoga.ts
maskedErrors: {
  errorMessage: defaultError,   // defaults to 'Something went wrong.'
  isDev: isDevEnv,              // Yoga adds detail in development
},
```

Developers can set a custom `defaultError` string, but cannot disable masking
without bypassing the framework.

**`RedwoodError` as the safe-error escape hatch**

`RedwoodError` (in `packages/api/src/errors.ts`) is the `SafeError` analogue
called for in the spec. Any error that subclasses `RedwoodError` is explicitly
opted in to client visibility. The `useRedwoodError` plugin intercepts execution
results and converts these into plain `GraphQLError`s so Yoga passes them
through unmasked:

```ts
// packages/graphql-server/src/plugins/useRedwoodError.ts
if (error.originalError instanceof RedwoodError) {
  return createGraphQLError(error.message, {
    extensions: error.extensions,
  })
}
```

All framework service-layer errors (`ServiceValidationError`,
`EmailValidationError`, etc.) extend `RedwoodError`, so they surface their
messages to clients intact while plain thrown `Error`s are masked.

**Stable error codes via a named class hierarchy**

`packages/graphql-server/src/errors.ts` provides a hierarchy of error classes,
each carrying a stable `extensions.code`:

| Class                 | `extensions.code`           |
| --------------------- | --------------------------- |
| `AuthenticationError` | `UNAUTHENTICATED`           |
| `ForbiddenError`      | `FORBIDDEN`                 |
| `UserInputError`      | `BAD_USER_INPUT`            |
| `ValidationError`     | `GRAPHQL_VALIDATION_FAILED` |
| `SyntaxError`         | `GRAPHQL_PARSE_FAILED`      |
| `RedwoodGraphQLError` | `REDWOODJS_ERROR` (default) |

This gives clients a consistent, parseable `extensions.code` field to branch on.

**Server-side logging of full error detail**

`useRedwoodLogger` logs full error objects server-side before masking occurs.
Severity is differentiated: `AuthenticationError` and `ForbiddenError` log at
`warn`; all other errors log at `error`. When `requestId` logging is enabled,
the log line includes the `x-request-id` header value, AWS Lambda request ID, or
a generated UUID — allowing all log lines for a single request to be correlated.

**Stack traces never sent to clients**

Yoga's masked error mode strips stack traces from responses unconditionally.

### Compliance gaps

**No per-error hash or unique error ID**

The spec recommends returning a unique identifier with each masked error so a
client can share it with support for lookup, while a hash of the error message
allows grouping of similar errors in logs. Currently, Cedar sends only the
generic masked message. There is no fingerprint on the response that would let
an operator find the exact log entry for a specific masked error instance.

**No explicit `exposedErrorCodes` allowlist**

The spec suggests a configuration-level allowlist of codes that are safe to
expose. Cedar's allowlist is implicit: any error that subclasses `RedwoodError`
passes through. This is expressive but not inspectable — you cannot enumerate at
configuration time which error codes will be visible to clients without reading
source code.

**No standardised error response envelope**

Beyond `message` and `extensions.code`, there is no enforced shape for error
payloads. Different services or directives may include different `extensions`
fields, which can break client tooling that expects a uniform structure.

---

## Work required for full compliance

### 1. Per-error hash and unique ID (high value, moderate effort)

Inside the `else` branch of `useRedwoodError` — i.e. only for errors that are
_not_ a `RedwoodError` and will therefore be masked — compute:

- `errorId` — a `uuidv4()` unique to this instance, so a client or support
  ticket can pinpoint the exact log entry.
- `errorHash` — a short hash (e.g. SHA-256 truncated to 8 hex chars) used to
  group recurrences of the same error _shape_.

**Important:** the hash must be derived from something stable across instances,
not the raw `error.message`. Dynamic messages (e.g. `"User 42 not found"`,
`"Connection refused at 192.168.1.5:5432"`) would produce a unique hash for
every occurrence, defeating the grouping purpose. Use the error's **constructor
name** (i.e. `error.originalError?.constructor?.name ?? error.name`) as the
hash input instead. For anonymous or plain `Error` instances this will produce
`"Error"`, which is an acceptable broad bucket.

Both values are added only to the **masked** error's `extensions` and to the
server-side log entry. They must not appear on `RedwoodError`-derived errors
that pass through unmasked, since those are already fully visible to clients.

```json
{
  "errors": [
    {
      "message": "Something went wrong.",
      "extensions": {
        "code": "INTERNAL_SERVER_ERROR",
        "errorId": "a1b2c3d4-...",
        "errorHash": "f3a8c912"
      }
    }
  ]
}
```

The server log entry at `error` level would include both fields alongside the
full original error so operators can search by `errorId` for a specific instance
or by `errorHash` to find recurrences of the same error class.

**Files to change:**

- `packages/graphql-server/src/plugins/useRedwoodError.ts` — add hash + ID
  generation in the masked-error (`else`) branch only.
- `packages/graphql-server/src/plugins/useRedwoodLogger.ts` — ensure `errorId`
  and `errorHash` are included in the log object when present.

**Dependencies:** `node:crypto` (already available); `uuid` is already a
dependency.

### 2. Explicit `exposedErrorCodes` allowlist (low–moderate effort)

Add an optional `exposedErrorCodes` array to `GraphQLYogaOptions`. When
provided, errors whose `extensions.code` matches one of the listed values are
passed through to the client unmasked.

```ts
// Proposed addition to GraphQLYogaOptions
exposedErrorCodes?: string[]
```

**Scope clarification:** this allowlist only applies to errors that already carry
an `extensions.code` — that is, `GraphQLError` instances and subclasses
(including `RedwoodGraphQLError`). Plain `Error` throws have no `extensions`
property and will never match a code in this list; they will continue to be
masked regardless. The allowlist is therefore an ergonomic alternative to
subclassing `RedwoodGraphQLError` for teams that already throw `GraphQLError`
instances with a known code (e.g. from a third-party library), not a general
mechanism for exposing arbitrary thrown errors.

The `useRedwoodError` plugin would consult this list alongside the
`instanceof RedwoodError` check. The precedence order is:

1. `instanceof RedwoodError` → pass through unmasked (existing behaviour).
2. `extensions.code` in `exposedErrorCodes` → pass through unmasked (new).
3. Everything else → mask and attach `errorId` + `errorHash` (see item 1).

**Files to change:**

- `packages/graphql-server/src/types.ts` — add `exposedErrorCodes` to
  `GraphQLYogaOptions`.
- `packages/graphql-server/src/createGraphQLYoga.ts` — thread the option through
  to the plugin.
- `packages/graphql-server/src/plugins/useRedwoodError.ts` — implement the
  allowlist check in the correct precedence position.

### 3. Standardised error envelope (low effort, high consistency value)

Define a canonical `extensions` shape for all Cedar GraphQL errors and enforce
it in `RedwoodGraphQLError`:

```ts
interface CedarErrorExtensions {
  code: string // always present
  errorId?: string // present on masked errors (see item 1)
  errorHash?: string // present on masked errors (see item 1)
  [key: string]: unknown // allow additional fields per error type
}
```

Document this shape so client tooling can rely on `extensions.code` always being
present and always being a string.

**Files to change:**

- `packages/graphql-server/src/errors.ts` — add the interface, tighten
  constructor typing.
- `packages/graphql-server/src/index.ts` — export the interface for downstream
  use.

---

## Prioritisation summary

| Item                          | Effort       | Value  | Recommended order |
| ----------------------------- | ------------ | ------ | ----------------- |
| Per-error hash + ID           | Moderate     | High   | 1                 |
| Standardised error envelope   | Low          | High   | 2                 |
| `exposedErrorCodes` allowlist | Low–moderate | Medium | 3                 |

Items 1 and 2 are closely related and could reasonably be implemented together
in a single PR. Item 3 is independent and can be scheduled separately.
