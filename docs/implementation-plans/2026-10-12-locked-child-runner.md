# Locked child runner (`@cedarjs/api/sandbox`)

Plan for a small, dependency-free way to run a Node script on untrusted bytes in
a locked-down child process, exported from `@cedarjs/api/sandbox`. It is
extracted from a production Cedar app (Effibo), where it runs sharp (libvips) on
uploaded photos and pdf.js on third parties' PDFs.

This is one of three related proposals that came out of the same work:

1. **Derived files (variants) in `@cedarjs/uploads`** — thumbnails and previews
   made from an upload. Making a variant means decoding an untrusted file, so
   variants would call this runner.
2. **Declarative recurring jobs and unique jobs in `@cedarjs/jobs`** — e.g.
   backfilling variants for files that don't have them yet, once per file.
3. **This runner.**

## Why

An app that accepts photos and PDFs from users or third parties decodes them
with large native or JavaScript parsers: libvips (C), pdf.js, archive and
spreadsheet libraries. Those parsers have bugs, and a crafted file that exploits
one runs code with whatever the process can reach. In a Cedar API process that
is everything: `DATABASE_URL`, API keys and session secrets in the environment,
`.env` on disk, every stored upload, the network.

Running the parser in a child process that has none of that turns "a parser bug
leaks every secret" into "a parser bug can read the file it was given". Node's
permission model makes that cheap: no container, no extra binary, no dependency,
and it works anywhere Node 24 does.

## What the runner does

- **Empty environment.** The child is spawned with `env: {}`.
- **Node's permission model.** `--permission`, with `--allow-fs-read` only for
  the child's script and the folders it's given. No `--allow-fs-write`,
  `--allow-child-process`, `--allow-worker`, `--allow-wasi` or
  `--allow-inspector`. `--allow-addons` only when the caller opts in
  (`allowAddons`), since sharp-like libraries are native.
- **No code from strings.** `--disallow-code-generation-from-strings`.
- **Bounded.** `--max-old-space-size`, a hard timeout (SIGKILL), an input cap
  checked before spawning, and an output cap that kills the child as soon as it
  is exceeded.
- **stdin in, stdout out.** The input goes to stdin; stdout is the result, and
  counts only on exit code 0. Every failure is a result
  (`{ ok: false, failure, message }`), never a rejection.
- **A concurrency limiter**, so a burst of uploads doesn't start a hundred Node
  processes.
- **A read-path resolver** (`sandboxReadPaths`) that works out which folders a
  child needs to read to import a package: the package and everything it depends
  on, including installed platform-specific optional packages.

### The API

```ts
import {
  createConcurrencyLimiter,
  findChildScript,
  runSandboxedChild,
  sandboxReadPaths,
} from '@cedarjs/api/sandbox'

const limit = createConcurrencyLimiter(2)

const result = await limit(() =>
  runSandboxedChild({
    script: findChildScript(import.meta.dirname, 'thumbnail.child')!,
    readable: sandboxReadPaths(['sharp'], { from: import.meta.url }),
    allowAddons: true,
    heapMb: 128,
    input: bytes,
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
    args: ['256'],
  })
)
// result: { ok: true, output: Buffer, stderr }
//       | { ok: false, failure: 'input-too-large' | 'timeout'
//           | 'output-too-large' | 'exit' | 'spawn-error', message, … }
```

Plus `sandboxedChildArgs()` (just the `node` arguments, for spawning the child
yourself) and `sandboxBlocksNetwork()`.

## Decisions

### A real implementation with tests, not a docs recipe

The configuration is short, but it is coupled to things that change under an app
without warning: Node's flags (`--experimental-permission` became
`--permission`; `--allow-addons` arrived later; a network permission is arriving
now) and how native packages lay out their binaries (sharp moved its binaries
into `@img/*` optional packages, and sharp 0.35 doesn't export its
`package.json`, which breaks the obvious
`require.resolve('sharp/package.json')`). A recipe copied into an app breaks
silently; framework code with tests breaks in Cedar's CI first.

### `@cedarjs/api/sandbox`, not a new package

Every Cedar app's api side already depends on `@cedarjs/api`, and it already
groups api-side utilities as subpath exports (`/logger`, `/cache`, `/webhooks`).
The runner has no dependencies, so the subpath costs nothing for apps that don't
use it, and there's no new package to publish and version. `@cedarjs/uploads`
already depends on `@cedarjs/api`, so variants can import it directly.

### Names people (and agents) search for

The exports use "sandbox", "child" and "untrusted" (in the JSDoc), so someone
looking for "run untrusted code in a sandbox" finds `runSandboxedChild` rather
than writing their own `spawn` call. Every export has JSDoc with an example, and
`packages/api/src/sandbox/README.md` explains what is and isn't covered.

### Fail closed

Native addons are off unless asked for (`allowAddons`), the child reads nothing
but its own script unless told otherwise, and every limit has a finite default
(256 MB heap, 10 s, 25 MiB in, 25 MiB out). A missing regular dependency in
`sandboxReadPaths` throws rather than returning a partial list.

### `sandboxReadPaths` walks `node_modules`, not `exports`

It finds packages the way Node finds a bare import (a `node_modules` folder next
to the file, then each folder above), reading no `exports` map, so it works for
packages that don't export their `package.json`. It follows each package's
`dependencies` and the installed `optionalDependencies` and `peerDependencies`.
That handles sharp without naming a platform: it yields `sharp`, `@img/colour`,
`detect-libc`, `semver`, `@img/sharp-<platform>` and
`@img/sharp-libvips-<platform>`. Yarn Plug'n'Play is not supported; Cedar apps
use the `node-modules` linker.

### Honest about what it isn't

Node's documentation says the permission model does not provide security
guarantees in the presence of malicious code. The runner is defense in depth. It
doesn't constrain native code at all: with `allowAddons`, an exploited native
addon can do anything the OS allows, and what still holds is the empty
environment, the heap cap and the timeout. An external binary such as ffmpeg
needs an OS-level sandbox. On Node 24 the permission model doesn't restrict
network access. The JSDoc and the README say all of this.

## What the tests guard

`packages/api/src/sandbox/*.test.ts`, run as part of `@cedarjs/api`'s tests.
Each probe is a real child script run through `runSandboxedChild`:

- the child sees none of the parent's environment (a secret set in the parent is
  absent);
- it can read the folders it's given, and not a file outside them (a `.env` next
  to them), nor the folder its own script is in;
- it can't write a file, spawn a process, start a worker thread, `eval`, or
  `dlopen` a native addon without `allowAddons`;
- network: on a Node with a network permission, it can't connect to a local
  server; on Node 24 the test asserts that it _can_, documenting the gap. When
  CI's Node gains the permission, the other branch runs;
- it's killed at the timeout, killed when its output passes the cap, refused
  before spawning when the input is over the cap, and fails when it runs out of
  heap;
- a failure reports the exit code and the last stderr line; a missing script is
  a failure, not a rejection;
- `sandboxedChildArgs` resolves symlinks (an app deployed behind a
  `current -> releases/…` link);
- the limiter caps concurrency, runs waiting tasks in order, and frees a slot on
  rejection;
- `sandboxReadPaths` finds nested and hoisted dependencies and installed
  optional ones, skips missing optional and peer ones, and throws on a missing
  regular one;
- **sharp in the child**: with exactly the paths `sandboxReadPaths(['sharp'])`
  returns and `allowAddons`, the child decodes a PNG and encodes a WebP; it
  fails without `allowAddons` (`ERR_DLOPEN_DISABLED`), and fails with only
  sharp's own folder readable. sharp is a devDependency of `@cedarjs/api` for
  this (prebuilt binaries via optional packages, no build step).

## Not in this change

- **Lint rules.** A rule that flags parsing libraries (sharp, pdfjs-dist,
  archive and spreadsheet parsers) imported in api code outside a sandboxed
  child would make this discoverable at the point of use. That's a separate
  step; the framework repo is moving from ESLint to oxlint
  ([plan](./2026-09-12-oxlint-and-oxfmt-migration.md)), and Cedar apps would get
  the rule through Cedar's lint config.
- **Sniffing a file's type by its bytes.** The caller should only send the child
  formats it is meant to decode, judged by magic bytes rather than the claimed
  content type. That belongs in `@cedarjs/uploads`, next to variants, not here.
- **pdf.js and other presets.** The production app also renders PDF pages with
  pdf.js and `@napi-rs/canvas` in the same runner; that, and the sharp
  thumbnailer itself, belong with variants in `@cedarjs/uploads`.

## Open questions

- **Network on Node 24.** The child can open connections (including to a cloud
  metadata endpoint). Options: document it and leave it to the OS (current
  choice); a preload that removes `net`/`dgram`/`http` from the child, which
  stops casual use but not native code; or wait for the permission model's
  network permission to reach the Node versions Cedar supports.
  `sandboxBlocksNetwork()` lets an app check at startup.
- **Allowing code generation.** `eval` is always off. Some libraries need it
  (older pdf.js builds, some template engines). An `allowCodeGeneration` option
  is easy to add if a real use comes up.
- **A ready-made sharp preset.** Variants will need "sharp in a sandboxed child"
  with the libvips loaders restricted. Should that live in `@cedarjs/uploads`
  (with variants) or here?
- **Child script location in builds.** `findChildScript` relies on the API build
  emitting each source file one-to-one (`foo.child.ts` → `foo.child.js`). If
  Cedar's API build bundles (e.g. for universal deploy), child scripts need to
  be emitted as separate entry points. Worth a check against the UD build.
- **Windows.** The permission model works on Windows and the tests avoid
  POSIX-only commands, but the production app runs on Linux and macOS only. The
  first Windows CI run will tell.
- **A pool instead of a process per call.** A Node child costs a few tens of ms
  and tens of MB to start. A pool of warm children would be faster but would let
  one input's exploit see the next input. One process per input is the safer
  default; revisit only with a measured need.
