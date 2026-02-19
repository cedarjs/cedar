/**
 * Type definitions for live query functionality
 * Defines interfaces and types for real-time GraphQL queries with @live directive
 */

import { type ModelSchema } from "../types/schema.js";

// Live query configuration options
export interface LiveQueryOptions {
  /**
   * Whether to automatically reconnect on connection loss
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Maximum number of reconnection attempts
   * @default 5
   */
  maxReconnectAttempts?: number;

  /**
   * Delay between reconnection attempts in milliseconds
   * @default 1000
   */
  reconnectDelay?: number;

  /**
   * Whether to use exponential backoff for reconnection delays
   * @default true
   */
  exponentialBackoff?: boolean;

  /**
   * Maximum delay between reconnection attempts in milliseconds
   * @default 30000
   */
  maxReconnectDelay?: number;

  /**
   * Custom headers to send with live query requests
   */
  headers?: Record<string, string>;

  /**
   * Custom authentication token
   */
  authToken?: string;

  /**
   * WebSocket URL for live query subscriptions
   */
  websocketUrl?: string;

  /**
   * Whether to enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Whether to resubscribe to queries upon reconnection
   * @default true
   */
  refetchOnReconnect?: boolean;
}

// Resolved options with all required fields (for internal use)
export type ResolvedLiveQueryOptions = Required<
  Omit<LiveQueryOptions, "authToken" | "websocketUrl">
> & {
  authToken: string | undefined;
  websocketUrl: string | undefined;
};

// Live query connection states
export type LiveQueryConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error"
  | "closed";

// Live query update types
export type LiveQueryUpdateType = "insert" | "update" | "delete" | "refresh";

// Live query update event
export interface LiveQueryUpdate<T = any> {
  /**
   * Type of update that occurred
   */
  type: LiveQueryUpdateType;

  /**
   * Updated data (for insert/update) or deleted item (for delete)
   */
  data?: T;

  /**
   * Complete updated result set (for refresh)
   */
  result?: T;

  /**
   * Timestamp when the update occurred
   */
  timestamp: Date;

  /**
   * Optional metadata about the update
   */
  metadata?: Record<string, any>;
}

// Live query error types
export interface LiveQueryError {
  /**
   * Error code
   */
  code: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Optional error details
   */
  details?: any;

  /**
   * Timestamp when the error occurred
   */
  timestamp: Date;
}

// Live query subscription interface
export interface LiveQuerySubscription<T = any> {
  /**
   * Unique identifier for this subscription
   */
  id: string;

  /**
   * GraphQL query string
   */
  query: string;

  /**
   * Query variables
   */
  variables?: Record<string, any>;

  /**
   * Current connection state
   */
  connectionState: LiveQueryConnectionState;

  /**
   * Latest query result
   */
  data: T | undefined;

  /**
   * Latest error, if any
   */
  error: LiveQueryError | undefined;

  /**
   * Whether the subscription is currently loading
   */
  loading: boolean;

  /**
   * Unsubscribe from live updates
   */
  unsubscribe: () => void;

  /**
   * Manually refetch the query
   */
  refetch: () => Promise<void>;

  /**
   * Register a callback for live data updates
   * Returns a function to unregister the callback
   */
  onUpdate: (callback: (update: LiveQueryUpdate) => void) => () => void;
}

// Live query client configuration
export interface LiveQueryClientConfig extends LiveQueryOptions {
  /**
   * GraphQL endpoint URL
   */
  endpoint: string;

  /**
   * WebSocket endpoint URL (optional, will derive from endpoint if not provided)
   */
  websocketUrl?: string;

  /**
   * Model schema defining scalar fields for each model
   */
  schema?: ModelSchema;
}

// Live query transport interface
export interface LiveQueryTransport {
  /**
   * Connect to the live query service
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the live query service
   */
  disconnect(): Promise<void>;

  /**
   * Subscribe to a live query
   */
  subscribe<T>(
    query: string,
    variables?: Record<string, any>,
    options?: LiveQueryOptions,
  ): LiveQuerySubscription<T>;

  /**
   * Get current connection state
   */
  getConnectionState(): LiveQueryConnectionState;

  /**
   * Add connection state change listener
   */
  onConnectionStateChange(
    listener: (state: LiveQueryConnectionState) => void,
  ): () => void;

  /**
   * Add error listener
   */
  onError(listener: (error: LiveQueryError) => void): () => void;
}

// Live query cache interface
export interface LiveQueryCache {
  /**
   * Get cached result for a query
   */
  get<T>(key: string): T | undefined;

  /**
   * Set cached result for a query
   */
  set<T>(key: string, data: T): void;

  /**
   * Remove cached result
   */
  remove(key: string): void;

  /**
   * Clear all cached results
   */
  clear(): void;

  /**
   * Get cache key for a query
   */
  getKey(query: string, variables?: Record<string, any>): string;
}

// Live query context value (for React context)
export interface LiveQueryContextValue {
  /**
   * Live query transport instance
   */
  transport?: LiveQueryTransport;

  /**
   * Live query cache instance
   */
  cache?: LiveQueryCache;

  /**
   * Global live query options
   */
  options?: LiveQueryOptions;

  /**
   * Model schema defining scalar fields for each model
   */
  schema?: ModelSchema;

  /**
   * Query builder instance with schema
   */
  queryBuilder?: any;

  /**
   * Whether the client is connected
   */
  isConnected: boolean;

  /**
   * Current connection state
   */
  connectionState: LiveQueryConnectionState;
}

// Hook return types for React integration (using explicit undefined for exactOptionalPropertyTypes)
export interface LiveQueryHookResult<T = any> {
  /**
   * Query result data
   */
  data: T | undefined;

  /**
   * Loading state
   */
  loading: boolean;

  /**
   * Error state
   */
  error: LiveQueryError | undefined;

  /**
   * Connection state
   */
  connectionState: LiveQueryConnectionState;

  /**
   * Refetch function
   */
  refetch: () => Promise<void>;

  /**
   * Subscription instance (for advanced usage)
   */
  subscription: LiveQuerySubscription<T> | undefined;
}
