# Declarative recurring jobs and unique jobs

Plan, and record of the implementation, for two additions to `@cedarjs/jobs`:

1. **Declared schedules.** A job declares the recurring schedules it runs on in
   `createJob({ schedules })`, and every job worker syncs them to the adapter
   when it starts: missing schedules are added, changed ones updated, ones that
   are no longer declared removed.
2. **Unique jobs.** `later(job, args, { key })` adds no job while a job with the
   same key is still queued, and tells the caller so.

It also documents a pattern, without code: a long job that works for a time
budget and then queues its own continuation ("yield and continue later").

This is one of three related proposals that came out of the same work on a
production app (Effibo), each in its own PR:

1. Derived files / variants on `@cedarjs/uploads` (thumbnails and other files
   made from an upload).
2. This one: declarative recurring jobs and unique jobs.
3. A "locked child" runner for parsing untrusted files in a sandboxed Node
   process.

## Background: the problem in a production app

Effibo runs about fifteen recurring jobs. With `@cedarjs/jobs` as it is, a
recurring job exists only as a row that someone created by calling
`later(Job, args, { cron })`. The app does that with a script that has to be run
by hand on every server after any change to a schedule. It's easy to forget, and
when it is forgotten the job silently never runs.

The script makes itself idempotent by deleting the old rows first, matching them
by the job's name inside the stored `handler` JSON (a `contains` on
`"JobName"`), then calling `later()` again. One job runs on two schedules with
different arguments (a frequent daytime sweep and a wider nightly one), and
because the cleanup matches by job name, both schedules have to live in a single
entry of the script, or re-running one entry would delete the other's row.

The same app throttles one job with an in-memory map: "don't queue thumbnails
for this case again within five minutes". It works per process only, so with
several API processes (or after a restart) the same work is queued several
times. A job key with "skip if a job with this key is already queued" replaces
that properly, enforced by the database.

The app also time-slices a long job: it stops after 45 seconds and queues its
own continuation, because the queue has one worker and other jobs (customer
mails) wait behind whatever runs. That's a consequence of the app's worker
config, not a Cedar problem, but a documented pattern helps the next app.

## Decisions

These were decided with the maintainer before the implementation:

- A real implementation with tests, not an RFC: tests fail when behavior
  changes, docs don't.
- Build on the cron support that exists (the Scheduler's `cron` option,
  `nextCronRunAt()`, the worker rescheduling a recurring job after a successful
  run, the `PrismaAdapter`'s `BackgroundJob` model) rather than adding a second
  scheduling mechanism.
- Schedules are declared in code, each with a stable identity (so one job can
  have several schedules with different args), synced idempotently on worker
  start, safe with several workers starting at once.
- Unique keys are race safe across processes: a database constraint, not
  check-then-insert.
- Names an agent (or a human) finds: `schedules`, `key`, `alreadyQueued`,
  `syncSchedules`. JSDoc on every new option, the jobs docs page updated. Lint
  rules are a later step (see
  [Discoverability](#discoverability-and-a-future-lint-rule)).
- Both features in one PR, as separate commits.

## Design principles applied

From [`docs/design-principles.md`](../design-principles.md), **fail closed**:

- The sync removes stored schedules that aren't declared. If finding the
  declarations is incomplete, that would silently delete schedules, which is
  exactly the failure this work exists to remove. So any job module that fails
  to import, any invalid declaration (bad cron, duplicate identity, a missing
  key) or an adapter that can't store schedules makes the sync throw, and the
  worker doesn't start. A loader override without `loadAllJobs()` throws instead
  of returning an empty list.
- A `key` passed to an adapter that doesn't support keys throws
  (`UniqueKeysNotSupportedError`) instead of being ignored.
- A `key` or declared schedule without the `key` column throws
  `KeyColumnMissingError`, which says what to add to the schema.

## API

### Declared schedules

```ts
export const ThumbnailsJob = jobs.createJob({
  queue: 'default',
  schedules: [
    { key: 'day', cron: '*/15 * * * *', args: [{ days: 1 }] },
    { key: 'night', cron: '45 4 * * *', args: [{ days: 14 }] },
  ],
  perform: async ({ days }: { days: number }) => {
    // ...
  },
})

// A job with one schedule needs no key
export const NightlyReportJob = jobs.createJob({
  queue: 'default',
  schedules: [{ cron: '0 0 * * *' }],
  perform: async () => {},
})
```

- `schedules?: readonly JobSchedule<NoInfer<TArgs>>[]` on `JobDefinition`.
  `args` is type checked against `perform()`'s parameters, required when
  `perform()` takes arguments and optional when it takes none. `NoInfer` keeps
  the schedules from widening or narrowing the inferred job arguments.
- `JobManagerConfig.scheduleAdapter?: keyof TAdapters`: which adapter stores the
  schedules. Optional when there's one adapter, an error when it's ambiguous.
- `JobManager.syncSchedules(jobs?)`: the sync. Defaults to every job in the
  project (`loadAllJobs()`), returns `{ created, updated, removed, unchanged }`
  (lists of keys), logs a one-line summary when something changed.
- `BaseAdapter.syncSchedules?({ schedules, keyPrefix })`: optional adapter
  method, implemented by `PrismaAdapter`.

### Unique jobs

```ts
const job = await later(RefreshThumbnailsJob, [page.id], {
  key: `thumbnails:${page.id}`,
  wait: 30,
})

if (job.alreadyQueued) {
  // nothing was added; `job` is the queued one
}
```

- `ScheduleJobOptions` gains `key?: string`, combinable with any timing option
  (none, `wait`, `waitUntil`, `cron`). To allow `{ key }` alone, the timing
  union got a member with none of the three.
- `PrismaAdapter.schedule()` returns `ScheduledPrismaJob`: `PrismaJob` plus
  `alreadyQueued: boolean`. The return type stays a job in both cases (the
  approach Oban takes with its `conflict?` flag), so existing callers that use
  `job.id` keep type checking.
- `BaseAdapter.supportsUniqueKeys` (default `false`).
- Keys starting with `cedar:` are reserved (`ReservedKeyError`).

## Storage: one nullable unique `key` column

Both features use one new column on the `BackgroundJob` model:

```prisma
key String? @unique
```

- Unique jobs store the caller's key.
- A declared schedule is one row whose key is
  `cedar:schedule:<JobName>:<scheduleKey>`. The prefix tells the sync which rows
  it owns, so it never touches rows created by `later()`, with or without a key.
- `NULL`s don't conflict in a unique index on PostgreSQL, MySQL or SQLite, so
  every job without a key coexists.

**Backward compatibility.** The `PrismaAdapter` never writes or filters on `key`
unless it has to, so an app without the column keeps working until it uses a key
or declares a schedule:

- `schedule()` only puts `key` in the insert when one was given.
- `find()` reads the candidate row whole (no `select`), so `key` is present on
  the row only when the column exists, and the lock write includes `key: null`
  only for a row that holds a key. `failure()` and `cancel()` do the same.
- `syncSchedules()` with no declared schedules and no column is a no-op (the
  column-missing validation error from Prisma is caught). With declared
  schedules it throws `KeyColumnMissingError`.

`yarn cedar setup jobs` adds the column for new apps. Existing apps add the line
to their model and run `yarn cedar prisma migrate dev`. It's a nullable column
plus a unique index, so existing rows need no backfill. This is covered by tests
that run the adapter against a second model without the column.

## Unique job semantics

A job **holds its key while it's queued**, and releases it the moment a worker
picks it up:

| State of the job with key `k`              | `later(..., { key: 'k' })`                          |
| ------------------------------------------ | --------------------------------------------------- |
| queued, waiting for `runAt` (incl. `wait`) | adds nothing, returns it with `alreadyQueued: true` |
| picked up / running                        | adds a new job                                      |
| waiting for a retry after an error         | adds a new job                                      |
| done, failed for good, or cancelled        | adds a new job                                      |
| recurring (`cron`) and its schedule active | adds nothing (the cron row holds its key)           |

Why release on pick-up rather than on completion: work requested while a job
runs may need another run (in the app's case, new photos arrived after the
thumbnail run started), so it must not be skipped. "Coalesce requests while
waiting" is the semantics the in-memory throttle approximated.

Only the key is compared; the queued job keeps its args and `runAt`. Callers put
whatever must be distinct into the key.

**How it's race safe.** `schedule()` inserts with the key. On a unique violation
(`P2002`) it reads the row holding the key and returns it with
`alreadyQueued: true`. If no row holds the key any more (a worker picked the job
up between the insert and the read), it inserts again, up to `MAX_KEY_RETRIES`
times. `find()` releases the key in the same `updateMany` that locks the job, so
there's no moment where a running job still holds its key. `failure()`
(permanent failure) and `cancel()` release it too.

## Sync semantics

- **When:** every long-running `cedar-jobs-worker` process syncs before its work
  loop starts (`getWorker()` in `bins/cedar-jobs-worker.ts`). `workoff` and
  `clear` don't sync. Under Unified Dev, `startJobsDevWorkers()` syncs once
  before starting the in-process workers, and logs a failed sync instead of
  throwing so a typo doesn't take down the dev server.
- **Why on worker start and not a CLI command:** deploys already restart the
  workers to load new code, so syncing there makes schedules follow the code
  with no extra step, which is the whole point. A separate command would be one
  more thing to forget. `JobManager.syncSchedules()` is public, so a script or a
  platform without long-running workers can call it.
- **Finding the declarations:** `loadAllJobs()` imports every module under
  `api/dist/jobs` (skipping tests, scenarios, mocks, `__tests__`, type
  declarations) and keeps exports that are built jobs (`perform`, `queue`,
  `name`, `path`). A job re-exported from several modules is one object, so it
  counts once. Under Unified Dev a `loadAllJobs` loader override does the same
  for `api/src/jobs` through Vite's SSR loader.
- **Identity:** the job's name plus the schedule's key (`default` when a job has
  one schedule and no key). Not the job's path: moving a file shouldn't recreate
  its schedules. Two jobs with the same name declaring the same key are an
  error.
- **Create:** a declared schedule without a stored row is inserted with `runAt`
  at the next cron match (same as `later(..., { cron })`).
- **Update:** compares `handler` (name, path, args), `queue`, `priority` and
  `cron`. A changed `cron` also moves `runAt` to the new next match, unless the
  job is running: then the worker sets the next `runAt` when the run finishes,
  from the cron it read when it picked the job up, so the new cron takes effect
  one run later. Changed args keep `runAt`.
- **Remove:** stored rows with the `cedar:schedule:` prefix whose key isn't
  declared are deleted (also when they're running; the run's outcome write then
  matches nothing, which is harmless).
- **Concurrency:** each schedule is one row with a unique key. A create that
  loses the race reads the winner's row and compares/updates it, so concurrent
  syncs end with one row per schedule and the same content.
- **Permanent failure / cancel:** the row releases its key, so the next sync
  creates a fresh schedule. The failed row stays (without a key) for its
  `lastError`. The worker's error log says the schedule restarts with the
  workers.
- **Time zone:** cron is evaluated in the worker's time zone, both at sync and
  at every reschedule, so they agree (an improvement over a script run in
  whatever shell).

### Environments and apps

Each environment has its own database and syncs its own schedules from its own
code. Per-environment differences are ordinary code:
`cron: process.env.X ?? '*/5 * * * *'`, or an empty `schedules` array behind a
flag.

The sync assumes **one app per jobs table**: it removes every `cedar:schedule:`
row it doesn't find in this app's code. Two different apps sharing one table
would remove each other's schedules. See open questions.

During a rolling deploy, old and new workers may sync different declarations;
the last worker to start wins, which in a normal rollout is a new one.

## Yield and continue later (docs only)

A section in `docs/docs/background-jobs.md`, "Long Jobs That Continue Later": a
job with a time budget that, when the budget runs out, queues itself with where
to continue (`later(Job, [id, afterId])`) and returns, so other jobs on the
queue get a turn. Points at multiple workers as the other fix.

## What the tests guard

Real-database tests (SQLite through `@prisma/adapter-better-sqlite3`, the same
setup `@cedarjs/tenancy` and `@cedarjs/uploads` use; each test file creates its
own database from the schema's SQL, so files still run in parallel). Two Prisma
clients on separate connections stand in for separate processes.

`src/core/__tests__/syncSchedules.test.ts`:

- creates the declared schedules (key, cron, queue, priority, `runAt` at the
  next match, handler)
- two schedules of one job with different args coexist, and a worker runs each
  with its own args
- a second sync changes nothing (idempotent, same rows)
- a changed cron updates the row in place and moves `runAt`; changed
  args/queue/priority update without moving `runAt`; a running row's `runAt` is
  left alone
- undeclared schedules (one of a job's, or a whole job's) are removed; an empty
  declaration removes all
- rows created by `later()` (cron, keyed, plain) are never touched
- a schedule that failed for good is recreated, the failed row kept
- six concurrent syncs on two connections create each schedule once; three
  concurrent syncs of a change agree
- invalid declarations throw and change nothing: missing keys, duplicate keys,
  same name in two jobs, bad cron
- `scheduleAdapter` is required with several adapters and honored when set; an
  adapter without `syncSchedules()` throws when schedules are declared and is a
  no-op when none are

`src/adapters/PrismaAdapter/__tests__/PrismaAdapter.uniqueKeys.test.ts`:

- a second enqueue with the same key while the first is queued adds nothing and
  returns the first with `alreadyQueued: true`; only the key is compared
- different keys and no key add jobs
- a new job is allowed once the first is picked up (its key is released), has
  run, is waiting for a retry, or was cancelled
- a keyed cron job holds its key across runs and releases it on permanent
  failure
- reserved `cedar:` keys are rejected
- 20 concurrent enqueues of one key on two connections add one job
- enqueues interleaved with two workers picking jobs up never leave two queued
  jobs with one key, nor a locked job holding a key
- a model without the `key` column: schedule, find, failure, cancel work without
  keys; a key or a declared schedule throws `KeyColumnMissingError`; a sync with
  nothing declared is a no-op

Also: Scheduler unit tests (key passed only to adapters that support it,
`UniqueKeysNotSupportedError`, reserved prefix), worker bin tests (syncs before
a long-running worker starts, not in `workoff`/`clear`, a failed sync stops the
worker from starting), `loadAllJobs()` tests against real files (nested dirs,
re-exports counted once, tests/scenarios/`__tests__` skipped, missing dir, a
broken module throws, overrides), Unified Dev tests (sync before workers start,
failed sync logged, `loadAllJobs` override wired), and type tests (schedule args
checked against `perform()`, required/optional args, `NoInfer`,
`scheduleAdapter` names, `key` with every timing option).

The concurrency tests were checked by mutation: making the sync rethrow unique
violations fails "don't create duplicates", and not releasing the key on pick-up
fails four unique-key tests.

## Discoverability and a future lint rule

Names were chosen to be found: `schedules` next to `queue` and `priority` in
`createJob()`, `key` in the scheduling options, `alreadyQueued` on the result,
`syncSchedules` on the manager and adapter. Each has JSDoc with an example, and
the jobs docs lead the recurring jobs section with declared schedules.

Cedar is moving its linting to oxlint (see
[the oxlint and oxfmt plan](2026-09-12-oxlint-and-oxfmt-migration.md)). A later
rule could flag `later(..., { cron })` in app code and point at `schedules`. Not
built here.

## Out of scope

- A CLI command (`cedar jobs sync`); see open questions.
- Uniqueness while running (`key` held until completion), or a time window ("not
  again within 5 minutes"). The pick-up semantics cover the motivating case; the
  others can be options on `key` later.
- Replacing a queued job's args (Oban's `replace`) on conflict.
- Namespacing schedules per app within one table.
- Any change to how a cron job is rescheduled after a run.

## Open questions

1. **Several apps sharing one jobs table.** The sync removes all
   `cedar:schedule:` rows it doesn't know. Is a namespace option on the
   `JobManager` worth adding, or is "one app per table" a fine documented rule?
2. **Should a failed sync stop the worker?** It does now (fail closed): a broken
   job module or invalid declaration keeps every worker from starting, which is
   loud but also stops unrelated queues. The alternative is to log and work
   without syncing.
3. **A `cedar jobs sync` command** for platforms where workers don't restart on
   deploy, or to see what a deploy would change. `syncSchedules()` is public, so
   a script can do it today.
4. **Postgres/MySQL coverage.** The race tests run on SQLite. The logic only
   relies on a unique index and Prisma's `P2002`, which all three providers
   have, but the repo has no Postgres unit test setup to prove it.
5. **Hold the key while running?** Some apps will want "at most one queued or
   running". It could be `key: { value, while: 'queued' | 'running' }` later
   without breaking the string form.
6. **Cancelling a declared schedule** stops it only until the next worker start.
   A way to pause a declared schedule (other than removing it from the code) may
   be wanted.
