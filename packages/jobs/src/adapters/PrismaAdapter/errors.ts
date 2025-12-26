import { CedarJSJobsError } from '../../errors.js'

/**
 * Thrown when a given model name isn't actually available in the PrismaClient
 */
export class ModelNameError extends CedarJSJobsError {
  constructor(name: string) {
    super(`Model \`${name}\` not found in PrismaClient`)
  }
}
