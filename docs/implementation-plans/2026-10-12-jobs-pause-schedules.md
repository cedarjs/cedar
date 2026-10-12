# Pausing declared schedules

Plan, and record of the implementation, for pausing and resuming a declared
recurring schedule of `@cedarjs/jobs` at runtime, without a code change or a
deploy. It builds on declared schedules (`createJob({ schedules })`), see
[Declarative recurring jobs and unique jobs](2026-10-12-declarative-recurring-and-unique-jobs.md),
and answers that plan's open question 6 ("Cancelling a declared schedule stops
it only until the next worker start").

## Why

A declared schedule follows the code: every worker start syncs it. That's the
point of declaring it, but it means the only way to stop a schedule for a while
(a nightly job that misbehaves during an incident, an export to a third party
that's down for maintenance) is a code change and a deploy, and the way back is
another one. `later.cancel()` doesn't help: it stops the schedule only until the
next worker start, which recreates it.

## API

```ts
const { alreadyPaused, pausedAt } = await jobs.pauseSchedule(
  ReportJob,
  'nightly'
)
const { wasPaused, runAt } = await jobs.resumeSchedule(ReportJob, 'nightly')
const schedules = await jobs.listSchedules()
```

```bash
yarn cedar jobs pause ReportJob:nightly
yarn cedar jobs resume ReportJob:nightly
yarn cedar jobs schedules
```

- `jobs.pauseSchedule(job, key?)` and `jobs.resumeSchedule(job, key?)` on the
  `JobManager`. `key` can be left out when the job declares a single schedule
  (whatever that schedule's key is).
- `pauseSchedule()` returns `{ key, alreadyPaused, pausedAt }`;
  `resumeSchedule()` returns `{ key, wasPaused, runAt }`. Pausing a paused
  schedule and resuming one that isn't paused change nothing and say so.
- `jobs.listSchedules()` returns the stored schedules: `key`, `jobName`,
  `scheduleKey`, `cron`, `runAt`, `pausedAt`, `running`.
- Errors (`ScheduleNotFoundError`): the job declares no schedules; no schedule
  with that key (the message lists the job's keys); several schedules and no
  key; the schedule is declared but not stored (the workers haven't started
  since it was declared). The CLI also names the jobs with schedules when the
  job name is unknown.
- Adapter methods, all optional like `syncSchedules()` and `cancel()`:
  `pauseSchedule({ key })`, `resumeSchedule({ key, runAt })` (each returns
  `null` for no stored schedule) and `listSchedules({ keyPrefix })`. A missing
  method throws `SchedulePausingNotSupportedError`, so a pause is never silently
  ignored. `syncSchedules()` may return `paused` (keys).

## Storage: a nullable `pausedAt` column

```prisma
pausedAt DateTime?
```

on the jobs model, next to `key`, so a new app gets both in one migration
(`yarn cedar setup jobs` adds both).

- `find()` adds `pausedAt IS NULL` to the query that picks a job and to the
  write that locks it, so a schedule paused between the two isn't locked. The
  filter is top level, so it also covers a worker reclaiming its own stale lock
  after a restart.
- `success()` and `error()` don't write `pausedAt`, so a run in progress when
  the schedule is paused finishes and its next run stays paused.
- The sync doesn't write `pausedAt`. It may update a paused schedule's cron,
  args, queue or priority, never unpauses it, and still removes a paused
  schedule that's no longer declared.
- Resume sets `pausedAt` to null and `runAt` to the next match of the declared
  cron from now, so runs missed while paused are not fired. A schedule that
  isn't running also gets `attempts: 0`, a clean slate like after a successful
  run. A running one keeps its `attempts`, because they identify the run's claim
  (`#claimedBy()`) and resetting them would make the run's outcome write miss.

**Backward compatibility.** Same approach as `key`: an app without the column
works as before.

- `find()` tries the `pausedAt` filter once and, if Prisma rejects the field as
  unknown, remembers that the model has no such column and leaves the filter out
  from then on.
- Pause and resume read the schedule's whole row; without `pausedAt` on it they
  throw `PausedAtColumnMissingError`, which names the line to add and the
  migration command. Without a `key` column they throw `KeyColumnMissingError`.
- The sync and the listing read whole rows, so they report nothing as paused.

Tests run the adapter against a model with neither column, and one with `key`
but no `pausedAt`.

## Where the next run comes from

`JobManager.resumeSchedule()` computes `runAt` from the cron declared in code
(`nextCronRunAt()`), and passes it to the adapter. Adapters don't need a cron
parser. The stored cron and the declared one are the same after a sync. If they
differ (code deployed, workers not restarted yet), the declared one is the one
the next sync stores anyway.

## Logging

- Pause and resume log at info.
- After a sync, every worker logs a warning listing the paused schedules and how
  to resume one. Warning rather than info, because `yarn cedar jobs` defaults to
  `LOG_LEVEL=warn` in production, where a forgotten pause matters most.

## CLI

`yarn cedar jobs` forwards to the `cedar-jobs` bin of `@cedarjs/jobs`, which
gets `pause <schedule>`, `resume <schedule>` and `schedules`. The bin loads the
jobs manager and all jobs from `api/dist`, like the workers, finds the job by
name and calls the `JobManager` methods. The schedule is `JobName` or
`JobName:key`; job names are identifiers, so everything after the first `:` is
the key.

The CLI command in `@cedarjs/cli` forwarded only the last positional argument,
which was enough for `work`, `start` and the others. It now forwards every
positional after `jobs`, so `pause ReportJob:nightly` reaches the bin whole.

## What the tests guard

`src/core/__tests__/pauseSchedules.test.ts` (real SQLite database):

- workers don't pick up a paused schedule, also not the worker that had it
  locked
- a run in progress finishes, `success()` reschedules it and it stays paused;
  `error()` keeps it paused too
- syncs keep it paused, list it in `paused` and log a warning; a changed cron
  and args are applied while paused; an undeclared paused schedule is removed
- pause: only the given schedule, `alreadyPaused` the second time, the default
  key, a single schedule with its own key
- resume: next run at the next cron match from now, not picked up for missed
  runs, picked up once due, `attempts` reset; a running job keeps its claim and
  its `success()` still lands; resuming an unpaused schedule changes nothing
- `listSchedules()`
- errors: unknown key, missing key with several schedules, job without
  schedules, declared but not stored, adapter without the methods,
  `scheduleAdapter`
- a model without `pausedAt` (sync and find work, pause/resume throw
  `PausedAtColumnMissingError`), and one without `key` either

Mutation checks: removing the `pausedAt` filter from `find()` fails four tests;
resetting `attempts` on a running job fails the claim test.

`src/bins/__tests__/cedar-jobs.schedules.test.ts`: argument parsing,
`JobName[:key]` splitting, pause/resume/list output and errors, against a real
database. `packages/cli/src/commands/__tests__/jobsHandler.test.ts`: the CLI
forwards the command's own arguments. Type tests for the `JobManager` methods.

## Out of scope

- Pausing jobs scheduled with `later()` (one-off or with `cron`), whole queues
  or job types.
- A pause that expires on its own (`pause --until`).
- Pausing from Unified Dev without a built api side: the CLI loads `api/dist`
  like the workers.

## Open questions

1. **Pausing other things.** A queue (stop all jobs on `email` during a provider
   outage) or a job type could use the same column or a separate table. Pausing
   one `later()` job is close to cancelling it.
2. **A paused schedule that fails for good.** If a run in progress when the
   schedule is paused fails permanently, the row releases its key as before, and
   the next sync creates a fresh, unpaused schedule. Rare (it takes the last of
   `maxAttempts` or a timeout during the pause), but the pause is lost.
3. **A crashed run on a paused schedule.** If the worker dies during a run and
   the schedule is paused, the row stays locked. After resuming, a worker with
   the same process name reclaims its own lock right away (as it would without
   the pause), so the run is retried before the next cron match.
4. **Who paused it, and why.** Only the time is stored. A `pausedReason` could
   be shown by `yarn cedar jobs schedules` and the worker warning.
