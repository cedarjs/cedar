export class CedarError extends Error {
  extensions: Record<string, any> | undefined
  constructor(message: string, extensions?: Record<string, any>) {
    super(message)
    this.name = 'CedarError'
    this.extensions = {
      ...extensions,
      code: extensions?.code || 'REDWOODJS_ERROR',
    }
  }
}

/**
 * @deprecated Use `CedarError` instead.
 * Preserved as a distinct class to maintain backward compatibility for code that checks
 * `error.name === 'RedwoodError'` or `instanceof RedwoodError`.
 */
export class RedwoodError extends CedarError {
  constructor(message: string, extensions?: Record<string, any>) {
    super(message, extensions)
    this.name = 'RedwoodError'
  }
}
