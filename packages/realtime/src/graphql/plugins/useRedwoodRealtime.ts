/**
 * Deprecated shim for backward compatibility.
 *
 * This file re-exports everything from the renamed implementation at
 * `./useCedarRealtime`. It exists so that code which imports directly from
 * the old path (`.../plugins/useRedwoodRealtime`) continues to work.
 *
 * NOTE: This shim will be removed in a future major release.
 *
 * @deprecated Please import `useCedarRealtime` and `CedarRealtimeOptions`
 * from `@cedarjs/realtime`.
 */
export * from './useCedarRealtime'
