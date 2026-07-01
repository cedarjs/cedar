# Plan: Debugger UD Integration Test

## Goal

Create a vitest-based integration test that verifies breakpoints bind and fire
correctly on API functions through the full `cedar dev --ud` CLI pipeline. The
test must exercise the actual Cedar CLI, Babel transforms, `openDebugger`,
and Vite SSR module evaluation — not just Vite in isolation.

## Approach

Copy an existing Cedar project fixture to a temp directory, install
dependencies, migrate/seed the database, then start `cedar dev --ud`
with `--debug-brk`, connect a CDP session, set breakpoints, make HTTP
requests, and verify they fire at correct source locations.

## Fixture Source and Setup

Use `__fixtures__/test-project-esm` in the Cedar repo — a complete ESM
Cedar project with `api/src/functions/hello.ts`, `cedar.toml`, both `api/`
and `web/` directories, and a maintained project structure.

CI already has a setup script at
`.github/actions/set-up-test-project-esm/setUpTestProjectEsm.mjs` that
handles the full setup:

1. Copies the fixture to a temp directory
2. Runs `yarn project:tarsync` (installs dependencies with workspace tarballs)
3. Generates a `SESSION_SECRET` in `.env`
4. Runs `yarn cedar prisma migrate reset --force`
5. Runs `yarn cedar prisma db seed`

The integration test should call this same script (or replicate its steps)
before running the debug scenarios.

## What the Test Does

1. Copy the fixture to `fs.mkdtempSync()`
2. Run `yarn install` in the temp dir
3. Run database migration and seed
4. Spawn `yarn node cedar dev --ud --debugBrk --apiDebugPort=... --fwd=--open=false`
5. Parse the inspector URL from the child process stderr
6. Connect a CDP WebSocket
7. Wait for `Debugger.scriptParsed` for `hello.ts`
8. Set `Debugger.setBreakpointByUrl` with the bare path URL at `hello.ts:2`
9. Make an HTTP request to trigger the handler
10. Wait for `Debugger.paused`
11. Assert the call frame URL and line number
12. Resume and assert the HTTP response

## Handling the `openDebugger` Pause/Resume Dance

After `Runtime.runIfWaitingForDebugger` unblocks `waitForDebugger()`, the
internal `inspector.Session` posts `Debugger.pause` and `Runtime.evaluate`.
This emits `Debugger.paused` to all connected sessions. The test must:

1. Receive `Debugger.paused`
2. Send `Debugger.resume`
3. Continue waiting for `scriptParsed` events

## Expected Results

Based on the CDP proxy investigation:

- `Debugger.setBreakpointByUrl` with `url` (bare path) returns a `breakpointId`
- `Debugger.setBreakpointByUrl` with `urlRegex` returns matching `locations`
  (`locs >= 1`)
- The breakpoint fires when the handler executes
- The call frame URL matches the original source file path
- The line number matches the expected source line (no offset)
- Stepping works after the pause

## Files to Create

| File | Purpose |
|------|---------|
| `tasks/debug-ud-test/vitest.config.mts` | Vitest config (singleThread, 300s timeout) |
| `tasks/debug-ud-test/debug-ud.test.mts` | The integration test |
| `tasks/debug-ud-test/tsconfig.json` | TypeScript config for the task |

No fixture files in the Cedar repo. The fixture is copied at runtime from
a path provided via environment variable (defaulting to
`cedar-gemini/__fixtures__/test-project-esm`).

## Key Technical Details

### Inspector URL Parsing

`inspector.open()` prints to stderr:
```
Debugger listening on ws://127.0.0.1:18911/2d44a85c-fc0c-43f5-b011-f48453e20b27
```

The test parses this with a regex to get the full URL including UUID.
Without the UUID, Node.js returns HTTP 400 on WebSocket upgrade.

### `/var` vs `/private/var` Symlinks

On macOS, `/var` is a symlink to `/private/var`. Vite's module graph
resolves the real path. The breakpoint URL must match the real path.
Using `fs.realpathSync()` on file paths before constructing URLs
resolves this.

### `openDebugger` Internal Session

The test must handle the pause emitted by `openDebugger`'s internal
`inspector.Session` after `waitForDebugger()` unblocks. The test should
receive `Debugger.paused`, send `Debugger.resume`, and then proceed.

## Dependencies

- `vitest` (already in the repo)
- `ws` (already in the repo)
- The fixture project (external, at `cedar-gemini/__fixtures__/test-project-esm`)

## Prior Validation

The mechanism was validated during the investigation using a CDP proxy
between the editor debug adapter and Node.js. The proxy captured real
debug adapter traffic showing:

```
>>> REQUEST: Debugger.setBreakpointByUrl       ← urlRegex sent
<<< BP id=2:0:0:file:///... locs=1            ← matched 1 location!
<<< PAUSED line=11 url=(none) reason=other     ← breakpoint fired
<<< PAUSED line=12 url=(none) reason=step      ← step works
```

The full investigation is documented in
`docs/implementation-plans/debugger-breakpoints-investigation.md`.

## Open Questions

1. Where should the test live in the Cedar repo? (e.g.,
   `tasks/debug-ud-test/`) The setup script at
   `.github/actions/set-up-test-project-esm/setUpTestProjectEsm.mjs` is in
   the same repo, so the test can import it directly or replicate its steps.

2. Does the fixture's database setup require specific env vars that the
   test needs to provide (database URL, etc.)? The CI script already
   handles this, so likely no extra work.

3. Which function file should the test target? `hello.ts` has both legacy
   `handler` and modern `handleRequest` variants — the test should cover
   at least one of each.
