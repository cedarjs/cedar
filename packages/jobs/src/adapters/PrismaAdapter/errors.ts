import { CedarJSJobsError } from '../../errors.js'

/**
 * Thrown when a given model name isn't actually available in the PrismaClient
 */
export class ModelNameError extends CedarJSJobsError {
  constructor(name: string) {
    super(`Model \`${name}\` not found in PrismaClient`)
  }
}

/**
 * Thrown when a job is scheduled with a unique `key`, or jobs declare
 * `schedules`, but the jobs model has no `key` column to store the key in
 */
export class KeyColumnMissingError extends CedarJSJobsError {
  constructor(model: string) {
    super(
      `The \`${model}\` model has no \`key\` column, which unique job keys ` +
        'and declared schedules need. Add `key String? @unique` to the ' +
        'model in your Prisma schema and create a migration with ' +
        '`yarn cedar prisma migrate dev`',
    )
  }
}

/**
 * Thrown when a job is paused or resumed, but the jobs model has no
 * `pausedAt` column to store the pause in
 */
export class PausedAtColumnMissingError extends CedarJSJobsError {
  constructor(model: string) {
    super(
      `The \`${model}\` model has no \`pausedAt\` column, which pausing ` +
        'jobs needs. Add `pausedAt DateTime?` to the model in your Prisma ' +
        'schema and create a migration with `yarn cedar prisma migrate dev`',
    )
  }
}
