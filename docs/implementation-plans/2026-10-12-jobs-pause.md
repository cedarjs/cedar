# Pausing jobs

Plan, and record of the implementation, for pausing and resuming a job of
`@cedarjs/jobs` at runtime, without a code change or a deploy.

## Why

A recurring job that misbehaves (a nightly export to a third party that's down,
a report that hammers the database during an incident) can only be stopped by
cancelling it, which is final, or by changing the code that schedules it and
deploying, which is slow, and the way back is another deploy. A pause that can
be undone with one command is what's missing.

## Decisions

- Jobs are addressed by their row id, so this works for every job a worker would
  pick up: recurring (`later(..., { cron })`) and one-off jobs waiting to run,
  including ones waiting to be retried.
- Stand-alone on `main`. It doesn't depend on declared schedules
  ([#3021](https://github.com/cedarjs/cedar/pull/3021), whose plan is
  `docs/implementation-plans/2026-10-12-declarative-recurring-and-unique-jobs.md`
  on that branch). Pausing a declared schedule by `Job:key`, and the schedule
  sync keeping a pause, belong with that PR.
- Fail closed: an unknown id, a completed or failed job, a model without the
  column, or an adapter that can't pause all throw. A pause is never silently
  ignored.

## API

```ts
const { alreadyPaused, pausedAt } = await jobs.pauseJob(42)
const { wasPaused, runAt } = await jobs.resumeJob(42)
const waiting = await jobs.listJobs({ limit: 20 })
```

```bash
yarn cedar jobs list [--limit 100] [--adapter name]
yarn cedar jobs pause name] < id > [--adapter
yarn cedar jobs resume name] < id > [--adapter
```

- On the `JobManager` (the `jobs` object), named `pauseJob`/`resumeJob`/
  `listJobs` because `jobs.pause()` reads like pausing every job.
- `{ adapter }` picks the adapter. It can be left out when the `JobManager` has
  a single adapter; otherwise leaving it out throws `AdapterNameRequiredError`.
- Pausing a paused job and resuming one that isn't paused change nothing and say
  so (`alreadyPaused`, `wasPaused`).
- Errors: `JobIdNotFoundError` (unknown id), `JobNotActiveError` (completed, or
  failed for good, which includes cancelled), `PausedAtColumnMissingError` (no
  column), `PauseNotImplementedError` (the adapter has no
  `pause()`/`resume()`/`list()`).
- Adapter methods, optional like `cancel()`: `pause({ jobId })`,
  `resume({ jobId })` and `list({ limit })`. Their presence is the capability.
- Pause and resume log at info.

## Storage: a nullable `pausedAt` column

```prisma
pausedAt DateTime?
```

on the jobs model. `yarn cedar setup jobs` adds it for new apps; existing apps
add the line and run `yarn cedar prisma migrate dev`. No backfill: `NULL` means
not paused.

- `find()` adds `pausedAt IS NULL` both to the query that picks a job and to the
  write that locks it, so a job paused between the two isn't locked. The filter
  is at the top level, so it also stops a restarted worker from reclaiming its
  own stale lock on a paused job.
- `success()` and `error()` don't write `pausedAt`. A run in progress when the
  job is paused finishes; a recurring job's next run, and a failed run's retry,
  stay paused.
- Resume:
  - a recurring job: `runAt` is the next cron match from now, so missed runs
    don't fire. Unless it's running, `attempts` resets to 0, a clean slate like
    after a successful run. A running job keeps `attempts`, because they
    identify its claim (`#claimedBy()`); resetting them would make the run's
    outcome write miss. The worker sets its next `runAt` when the run ends.
  - a one-off job keeps its `runAt`: it runs then, or as soon as a worker is
    free when that time has passed (it's due, nothing needs changing).
- The pause lives on the row. Code that deletes and recreates its recurring jobs
  (a scheduling script run on deploy) creates new, unpaused rows. The docs say
  so and point at declared schedules.

**Backward compatibility.** `main` has no other optional column, so the
detection is built here, following the approach of #3021's `key` column:

- `find()` filters on `pausedAt` once. If Prisma rejects the field as unknown,
  the adapter remembers the model has no such column and leaves the filter out
  from then on.
- `pause()`/`resume()` read the whole row; without `pausedAt` on it they throw
  `PausedAtColumnMissingError`, which names the line to add and the migration
  command.
- `list()` reads whole rows and reports `pausedAt: null` without the column.

## Test setup

The jobs package's tests mocked Prisma. To test against a real database, this
adds the same setup `@cedarjs/tenancy` and `@cedarjs/uploads` use (and #3021
adds to this package): a unit test schema, a generated client, and
`createTestDb()`, which creates a fresh SQLite database per test file from the
schema's SQL, so no `prisma db push` is needed. The schema has the
`BackgroundJob` model and a `LegacyBackgroundJob` without `pausedAt`.

## What the tests guard

`src/core/__tests__/pauseJobs.test.ts`:

- workers don't pick up a paused job, also not the worker that had it locked
- a run in progress finishes; a recurring job's reschedule (`success()`) and a
  retry (`error()`) stay paused; a job waiting for a retry can be paused
- pause: stored, logged, `alreadyPaused` the second time
- resume: recurring job at the next cron match from now with `attempts` reset
  and missed runs not fired; one-off job keeps a future `runAt`; one whose time
  passed runs right away; a running job keeps its claim and its `success()`
  lands; resuming an unpaused job changes nothing
- `listJobs()`: active jobs only, next first, `limit`
- errors: unknown id, cancelled, completed, adapter without the methods, several
  adapters without a name
- a model without `pausedAt`: jobs are scheduled and run, pause/resume throw,
  listing works
- a starting worker warns about paused jobs in its own queues only, names
  the first 10 and counts the rest, stays quiet with none, in `workoff`,
  without the column or without `list()`, and starts when the check fails

Mutation checks: removing the `pausedAt` filter from `find()` fails six tests;
moving a one-off job's `runAt` on resume fails two; resetting `attempts` on a
running job fails the claim test.

Also: `src/bins/__tests__/cedar-jobs.pause.test.ts` (argument parsing, id
parsing, command output and errors, against a real database),
`packages/cli/src/commands/__tests__/jobsHandler.test.ts` (the CLI forwards the
command's own arguments; it forwarded only the last positional, which dropped
`pause` from `pause 42`), and type tests.

## Out of scope

- Pausing a declared schedule by `Job:key`, and the schedule sync keeping
  `pausedAt` (with #3021).
- Pausing a whole queue or every job of a type.
- A pause that expires on its own.
- Running the CLI without a built api side (Unified Dev): it loads `api/dist`
  like the workers do.

## Decided after review

1. **Workers log paused jobs at start.** A long-running worker (not `workoff`
   or `clear`) lists the paused jobs in its queues through the adapter's
   `list({ paused: true, queues })` and logs one warning: the count, the first
   10 ids and job names, "and N more", and how to resume. Nothing is logged
   without paused jobs, without a `pausedAt` column, or with an adapter that
   can't list. A failed query is logged and the worker starts anyway.
2. **A crashed run on a paused job is documented, not changed.** If the worker
   dies mid-run while the job is paused, the row stays locked. After resuming,
   a worker with the same process name reclaims its own lock right away, as
   it would without the pause, so the run is retried before its next run time.

## Follow-ups

- **Who paused a job, and why** (`pausedReason`): not now. It fits with a UI
  for jobs.
- **Pausing whole queues or job types**, for example all mail during a
  provider outage: out of scope here.
