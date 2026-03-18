// The excess of exports here is for backwards compatibility
// since `@redwoodjs/internal` exported everything from babel/api, web, and common.
// See https://github.com/redwoodjs/redwood/blob/44b4a9023ac3a14b5f56b071052bdf49c410bb8b/packages/internal/src/index.ts#L13-L16.

export {
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  TARGETS_NODE,
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  getApiSideBabelConfigPath,
  /** Used by @cedarjs/internal and @cedarjs/testing */
  getApiSideBabelPlugins,
  /** Used by @cedarjs/testing */
  getApiSideBabelPresets,
  /** Used by @cedarjs/testing and @cedarjs/eslint-config */
  getApiSideDefaultBabelConfig,
  /** Used by @cedarjs/cli, @remix/cli-helpers and @cedarjs/prerender */
  registerApiSideBabelHook,
  /** Used by @cedarjs/internal and @cedarjs/vite */
  transformWithBabel,
} from './api'

export {
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  getWebSideBabelConfigPath,
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  getWebSideBabelPlugins,
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  getWebSideBabelPresets,
  /** Used by @cedarjs/cli, @remix/eslint-config and @cedarjs/vite */
  getWebSideDefaultBabelConfig,
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  getWebSideOverrides,
  /** Used by @cedarjs/prerender */
  registerWebSideBabelHook,
} from './web'

export type { Flags } from './web'

export {
  /** Used by our eslint-config  */
  getCommonPlugins,
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  getPathsFromTypeScriptConfig as getPathsFromConfig,
  /** Used by vite */
  getRouteHookBabelPlugins,
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  parseTypeScriptConfigFiles,
  /**
   * @deprecated This export isn't used by the framework, so it'll be removed
   * in a future version.
   */
  registerBabel,
} from './common'
