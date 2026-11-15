/**
 * The app's `@cedarjs/tenancy/web`, or a module whose `clearOrgClients` is
 * `undefined` in an app without tenancy. See `cedarVitestWebConfigPlugin`.
 */
declare module 'virtual:cedar-testing-tenancy-web' {
  export const clearOrgClients: (() => Promise<void>) | undefined
}
