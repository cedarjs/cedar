import console from 'node:console'

export const DEFAULT_MAX_ATTEMPTS = 24
/** 4 hours in seconds */
export const DEFAULT_MAX_RUNTIME = 14_400
/**
 * Extra time, in seconds, beyond `maxRuntime` before another worker may treat
 * a job's lock as abandoned. The worker that locked the job enforces its own
 * `maxRuntime` timeout, so this grace period gives it time to record the
 * timeout and mark the job as failed without a second worker claiming (and
 * re-executing) the job while that's happening. Only jobs whose worker died
 * without cleaning up after itself are ever claimed this way.
 */
export const MAX_RUNTIME_GRACE_PERIOD = 60
/** 5 seconds */
export const DEFAULT_SLEEP_DELAY = 5

export const DEFAULT_DELETE_SUCCESSFUL_JOBS = true
export const DEFAULT_DELETE_FAILED_JOBS = false
export const DEFAULT_LOGGER = console
export const DEFAULT_QUEUE = 'default'
export const DEFAULT_WORK_QUEUE = '*'
export const DEFAULT_PRIORITY = 50
export const DEFAULT_WAIT = 0
export const DEFAULT_WAIT_UNTIL = null
export const PROCESS_TITLE_PREFIX = 'cedar-jobs-worker'
// TODO: Change this to 'backgroundJob' in the next major release
export const DEFAULT_MODEL_NAME = 'BackgroundJob'

/**
 * The name of the exported variable from the jobs config file that contains
 * the adapter
 */
export const DEFAULT_ADAPTER_NAME = 'adapter'
/**
 * The name of the exported variable from the jobs config file that contains
 * the logger
 */
export const DEFAULT_LOGGER_NAME = 'logger'
