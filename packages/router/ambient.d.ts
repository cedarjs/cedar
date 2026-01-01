/* eslint-disable no-var */
/// <reference types="react/experimental" />
import type { ViteRuntime } from 'vite/runtime'

declare global {
  var __REDWOOD__PRERENDERING: boolean
  var __rwjs__vite_ssr_runtime: ViteRuntime | undefined
  var __rwjs__vite_rsc_runtime: ViteRuntime | undefined

  /**
   * URL or absolute path to the GraphQL serverless function, without the trailing slash.
   * Example: `./redwood/functions/graphql` or `https://api.redwoodjs.com/graphql`
   */
  var RWJS_API_GRAPHQL_URL: string

  /**
   * URL or absolute path to serverless functions, without the trailing slash.
   * Example: `./redwood/functions/` or `https://api.redwoodjs.com/`
   **/
  var RWJS_API_URL: string

  /**
   * Is the experimental Streaming/SSR feature enabled?
   */
  var RWJS_EXP_STREAMING_SSR: boolean

  /**
   * Is the experimental RSC feature enabled?
   */
  var RWJS_EXP_RSC: boolean

  interface Thenable<T> {
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2>
  }

  namespace NodeJS {
    interface Global {
      /**
       * This global is set to true by the prerendering CLI command.
       */
      __REDWOOD__PRERENDERING: boolean

      /** URL or absolute path to the GraphQL serverless function */
      RWJS_API_GRAPHQL_URL: string
      /** URL or absolute path to serverless functions */
      RWJS_API_URL: string
    }
  }
}

export {}
