## User

I have a working graphql backend defined in `backend/`. It is using websockets and `@n1ru4l/graphql-live-query` to implement support for the `@live` graphql directive for realtime updates in connected gql clients.

I can connect to the backend using the GraphiQL application and send queries like this

```
query Bob @live {
  user(id: "54e6f45d-11fb-4a61-ad59-4c036b707ba2") {
    id
    name
    isActive
  }
}
```

and it'll receive live updates if I connect with another gql client and send mutations.


I'm now working on my own React hook called `useLiveQuery` in [@useLiveQuery.ts](file:///Users/tobbe/tmp/gqlorm/src/react/useLiveQuery.ts). I have a test app in [@App.tsx](file:///Users/tobbe/tmp/gqlorm/test-app-with-backend/App.tsx) that uses the hook and when I first open it up in my web browser I can connect to the backend and get initial data. But I'm not getting live updates.

Here's the output from the web browser console when I load my test app


07:20:58.688 Navigated to http://localhost:5174/
07:20:58.737 client:733 [vite] connecting...
07:20:58.741 client:827 [vite] connected.
07:20:58.770 transport.ts:50 [LiveQueryTransport] Initialized with options: {autoReconnect: true, maxReconnectAttempts: 5, reconnectDelay: 1000, exponentialBackoff: true, maxReconnectDelay: 30000, …}
07:20:58.770 installHook.js:1 [LiveQueryTransport] Initialized with options: {autoReconnect: true, maxReconnectAttempts: 5, reconnectDelay: 1000, exponentialBackoff: true, maxReconnectDelay: 30000, …}
07:20:58.788 transport.ts:171 [LiveQueryTransport] WebSocket connected
07:20:58.791 transport.ts:342 [LiveQueryTransport] Sending query: query findManyUser @live {
  users {
    id
    name
    email
    isActive
  }
}
07:20:58.791 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_1_1768890058782
07:20:58.791 transport.ts:342 [LiveQueryTransport] Sending query: query findUniqueUser($var0: ID!) @live {
  user(id: $var0) {
    id
    name
    email
    isActive
  }
}
07:20:58.791 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_2_1768890058782
07:20:58.791 transport.ts:342 [LiveQueryTransport] Sending query: query findManyUser @live {
  users {
    id
    name
    email
    isActive
  }
}
07:20:58.791 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_3_1768890058782
07:20:58.791 transport.ts:342 [LiveQueryTransport] Sending query: query findManyUser @live {
  users {
    id
    name
    email
    isActive
  }
}
07:20:58.791 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_1_1768890058782
07:20:58.791 transport.ts:342 [LiveQueryTransport] Sending query: query findUniqueUser($var0: ID!) @live {
  user(id: $var0) {
    id
    name
    email
    isActive
  }
}
07:20:58.791 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_2_1768890058782
07:20:58.791 transport.ts:342 [LiveQueryTransport] Sending query: query findManyUser @live {
  users {
    id
    name
    email
    isActive
  }
}
07:20:58.791 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_3_1768890058782
07:20:58.833 transport.ts:215 [LiveQueryTransport] WebSocket closed: 4409 Subscriber for sub_1_1768890058782 already exists
07:20:58.833 transport.ts:317 [LiveQueryTransport] Reconnecting in 1000ms (attempt 1)
07:20:59.837 transport.ts:171 [LiveQueryTransport] WebSocket connected
07:20:59.837 transport.ts:342 [LiveQueryTransport] Sending query: query findManyUser @live {
  users {
    id
    name
    email
    isActive
  }
}
07:20:59.837 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_1_1768890058782
07:20:59.838 transport.ts:342 [LiveQueryTransport] Sending query: query findUniqueUser($var0: ID!) @live {
  user(id: $var0) {
    id
    name
    email
    isActive
  }
}
07:20:59.838 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_2_1768890058782
07:20:59.838 transport.ts:342 [LiveQueryTransport] Sending query: query findManyUser @live {
  users {
    id
    name
    email
    isActive
  }
}
07:20:59.838 transport.ts:360 [LiveQueryTransport] Sent subscription: sub_3_1768890058782
07:20:59.845 transport.ts:374 [LiveQueryTransport] Received message: {id: 'sub_2_1768890058782', type: 'next', payload: {…}}
07:20:59.845 transport.ts:413 [LiveQueryTransport] Received data for subscription: sub_2_1768890058782 {errors: Array(1)}
07:20:59.846 transport.ts:374 [LiveQueryTransport] Received message: {id: 'sub_2_1768890058782', type: 'complete'}
07:20:59.846 transport.ts:474 [LiveQueryTransport] Subscription completed: sub_2_1768890058782
07:20:59.847 transport.ts:374 [LiveQueryTransport] Received message: {id: 'sub_1_1768890058782', type: 'next', payload: {…}}
07:20:59.847 transport.ts:413 [LiveQueryTransport] Received data for subscription: sub_1_1768890058782 {data: {…}}
07:20:59.847 transport.ts:374 [LiveQueryTransport] Received message: {id: 'sub_1_1768890058782', type: 'complete'}
07:20:59.847 transport.ts:474 [LiveQueryTransport] Subscription completed: sub_1_1768890058782
07:20:59.850 transport.ts:374 [LiveQueryTransport] Received message: {id: 'sub_3_1768890058782', type: 'next', payload: {…}}id: "sub_3_1768890058782"payload: data: users: (3) [{…}, {…}, {…}][[Prototype]]: Object[[Prototype]]: Objecttype: "next"[[Prototype]]: Object
07:20:59.851 transport.ts:413 [LiveQueryTransport] Received data for subscription: sub_3_1768890058782 {data: {…}}
07:20:59.853 transport.ts:374 [LiveQueryTransport] Received message: {id: 'sub_3_1768890058782', type: 'complete'}id: "sub_3_1768890058782"type: "complete"[[Prototype]]: Object
07:20:59.853 transport.ts:474 [LiveQueryTransport] Subscription completed: sub_3_1768890058782



Can you please help me figure out why I'm not getting any live updates from the backend?

## Assistant

<thinking>
**Examining Live Updates**

I'm currently focused on the live updates, or lack thereof. The initial data loads fine, so the initial connection and query are working, but the live updates aren't flowing through. The connection to the WebSocket is also established, which eliminates a core issue. I'm checking the GraphQL backend's implementation of the `@live` directive, as it seems that is where the bottleneck lies.


**Debugging Subscription Behavior**

I've been poring over the console logs, and the "complete" message after receiving data is a major red flag. It seems the live queries are terminating immediately after providing the initial data, which runs contrary to the expected continuous update behavior. I'm suspecting there's a problem in how the subscriptions are being handled, possibly related to ID management or the hook's lifecycle interaction within React, compounded by the possibility of the backend closing the connection too early.


**Pinpointing the Culprit**

I'm now zeroing in on the "Subscriber already exists" error. It strongly suggests a timing issue within the `useLiveQuery` hook, specifically concerning subscription lifecycle management. It's likely the hook isn't properly cleaning up subscriptions before creating new ones, especially when React re-renders, causing a race condition on the server. Moreover, I need to investigate the transport logic to dissect the message exchange further, which might highlight the problem.


**Decoding Transport and React**

I'm deep in the code now, starting with `src/live/transport.ts`, and I'm parsing its WebSocket implementation to understand message handling and ID management. After that, I'll dive into `src/react/LiveQueryProvider.tsx` and `src/react/index.ts` to see how the transport is initialized and integrated with React, which will help me understand potential conflicts in lifecycle management that could trigger the duplicate subscriber error. I'm especially interested in how the hook interacts with the transport during re-renders.


**Deciphering the Hook's Lifecycle**

I'm now examining the `useLiveQuery` hook in detail, specifically the lifecycle and dependency array. I've spotted a potential issue where frequent re-renders with new variable objects, even if the data remains the same, could cause the hook to prematurely unsubscribe and resubscribe. This could very well lead to the "already exists" error on the backend. Next, I'll scrutinize how the `unsubscribe` method is implemented.


**Examining Query Construction**

I'm now investigating the query construction process. My hunch is that the backend is terminating subscriptions prematurely. The 'complete' message immediately after receiving data is a significant indicator. I will examine how the client is constructing the GraphQL query with the `@live` directive, especially how variables are handled, and how it is transmitted over the WebSocket. I am also going to confirm the message structure matches the expected backend library format.



</thinking>

I will read the `src/live/transport.ts` file to understand how the WebSocket transport is implemented and how it handles subscriptions. I will also read `src/react/LiveQueryProvider.tsx` to see how the transport is initialized and used.



**Tool Call: src/live/transport.ts**
Status: Completed

**Tool Call: src/react/LiveQueryProvider.tsx**
Status: Completed

## Assistant

<thinking>
**Revisiting the Code**

I've been examining the `unsubscribe` implementation within `src/live/transport.ts`. The code removes a subscription and checks the WebSocket's ready state, ensuring proper cleanup. I'm focusing on potential edge cases and error handling during the deletion process.


**Examining Subscription IDs**

I'm now investigating how the client handles reconnection and resubscription. The `connect()` method acknowledges the connection and processes a message queue. I need to determine if queued subscription messages might reuse old subscription IDs, potentially causing the "Subscriber already exists" error.


**Analyzing Reconnections**

I've pinpointed the issue: upon reconnection, the client *does* resend the subscription messages. The `processMessageQueue` function is the culprit. The client is storing subscription requests, and upon reconnecting, it's sending them again with the same IDs. This is happening because the subscriptions are still in the queue.


**Analyzing Refetch Behavior**

I'm now investigating the `refetch` mechanism.  The `useLiveQuery` hook triggers `refetch` on reconnect, which in turn calls `#sendSubscription` with the original subscription ID. This confirms my hypothesis: the client is using the same IDs for resubscription, causing the backend error.


**Examining Refetch Logic**

I've been analyzing the interaction between `useLiveQuery` and the `transport`. After the websocket reconnects, `refetch()` is called, and this resends the subscription *using the original subscription ID*. This is the root cause of the duplicate subscription message and the backend error. This explains how the same IDs are reused, leading to the conflict.


**Examining Double Subscriptions**

The logs now point to the problem: `useLiveQuery` is causing the double subscriptions. Immediately after the WebSocket connects and the subscription is sent initially, the `connected` state triggers a `refetch`, which resends the subscription with the original ID. This double-sending is the root cause.


**Tracing the Root Cause**

I'm now investigating how the client's `useLiveQuery` hook and transport layer interact during reconnection. The double-sending of subscription messages with the same IDs arises because `refetch` uses the original subscription ID. The `connected` state triggers `refetch`, but the initial subscription also sends, resulting in duplication.


**Identifying the Duplicates**

The client's code uses `refetch` within `useLiveQuery` to resend the original subscription. The critical issue is the `refetch` mechanism: it leverages the same, *existing* subscription ID to resend the subscription, causing the backend error. My current work is focusing on understanding the interaction between the `useLiveQuery` and the `refetch` functionality during the connection and reconnection phases.


**Refining the Theory**

I'm now revisiting the theory that React Strict Mode causes duplicate subscriptions. The initial subscription is sent, then the component remounts, and then `refetch` is called. It seems that double-mounting, caused by Strict Mode, is causing the component to subscribe and then resubscribe using `refetch` with the same ID.


**Identifying the Double Send**

I'm now focusing on the simultaneous sending of subscription messages with the same ID, specifically during the initial connection phase. React's Strict Mode might play a role. When connected, `refetch()` is called, causing the resending of the subscription with the original ID. This suggests `refetch()` is being called very soon after the initial subscription, potentially due to Strict Mode double-mounting.


**Uncovering the Duplicates**

I'm now zeroing in on the double subscription issue, with the core problem seemingly in the interplay between `processMessageQueue` sending initial subscriptions and the `refetch` mechanism triggered by connection state changes. This confirms that the race condition lies in sending subscriptions when the connection is established.


**Re-evaluating the Strategy**

I'm now contemplating modifying the transport layer to automatically resubscribe. This would shift responsibility away from `useLiveQuery`, focusing on the core problem: redundant subscription requests. This approach aims to streamline the logic by centralizing subscription management within the transport.


**Examining the Solution**

I'm now implementing the proposed solution. I'm focusing on cleaning up the subscription queue within the `transport.ts` and removing the redundant refetch within `useLiveQuery.ts`. I'm starting by addressing the `messageQueue` issue in the transport layer, and verifying the existing `refetchOnReconnect` option.



</thinking>

I will read `src/live/types.ts` to confirm the availability of the `refetchOnReconnect` option in `ResolvedLiveQueryOptions` and checking for any other relevant type definitions.



**Tool Call: src/live/types.ts**
Status: Completed

## Assistant

<thinking>
**Adding refetch support**

I'm now revisiting `src/live/types.ts` to add `refetchOnReconnect` to the `LiveQueryOptions`. This seems like the cleanest approach. Then, I'll update `src/live/transport.ts` to resend subscriptions upon reconnection, using this new option. Finally, I will address `src/react/useLiveQuery.ts` and make the corresponding adjustments. This will tidy everything up and ensure the desired behavior.



</thinking>

I will update `src/live/types.ts` to include `refetchOnReconnect` in `Live

<thinking>
**Considering types update**

I've decided to add `refetchOnReconnect` to `LiveQueryOptions` in `src/live/types.ts`. This simplifies the implementation and makes the option available throughout the transport layer. Now, I will proceed to modify `src/live/transport.ts` to utilize this new option and resend subscriptions upon reconnection, ensuring the desired behavior. After that, I will update `src/react/useLiveQuery.ts`.



</thinking>

QueryOptions` and `ResolvedLiveQueryOptions`, ensuring proper type support. Then, I will modify `src/live/transport.ts` to implement the automatic resubscription logic upon reconnection, replacing the message queue for subscriptions. Finally, I will update `src/react/useLiveQuery.ts` to remove the redundant manual refetching logic.



**Tool Call: src/live/types.ts:   /**... =>   /**...**
Status: Completed

Diff: types.ts
```
/**
 * Type definitions for live query functionality
 * Defines interfaces and types for real-time GraphQL queries with @live directive
 */

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

```


## Assistant

<thinking>
**Revising Implementation Logic**

I'm now adjusting `src/live/transport.ts` to implement the core logic. Recent changes include refining how subscriptions are handled when the connection is down. Instead of queueing subscription messages, I'm now focusing on triggering auto-connect. Upon receiving `connection_ack`, I will iterate through the subscriptions to send them. I'm also ensuring the constructor handles `refetchOnReconnect` defaults appropriately.



</thinking>

I will update `src/live/transport.ts` to implement automatic resubscription logic. This involves initializing `ref

<thinking>
**Applying Core Subscription Changes**

I'm now revising `src/live/transport.ts` again, focusing on the subscription flow. I've removed the message queue usage for subscriptions, opting to directly add them to `#subscriptions`. The core change involves triggering auto-connect on subscription if disconnected. Furthermore, on receiving `connection_ack`, I'm iterating through the subscriptions and sending them using the `#resubscribeAll` method. I have also ensured the constructor handles the `refetchOnReconnect` option, which defaults to true, and I am applying these changes.



</thinking>

etchOnReconnect` in the constructor, removing the subscription queuing mechanism in `subscribe`, and adding a `#resubscribeAll` method that is called upon receiving a `connection_ack` message.



**Tool Call: src/live/transport.ts:       websocketUrl: options.we... =>       websocketUrl: options.we...**
Status: Failed

Failed to edit, Expected 3 occurrences but found 1 for old_string in file: /Users/tobbe/tmp/gqlorm/src/live/transport.ts

**Tool Call: src/live/transport.ts:     // Send subscription messa... =>     // Send subscription messa...**
Status: Completed

Diff: transport.ts
```
/**
 * WebSocket-based transport layer for live queries
 * Implements the LiveQueryTransport interface using WebSocket connections
 */

import {
  LiveQueryTransport,
  LiveQuerySubscription,
  LiveQueryConnectionState,
  LiveQueryError,
  LiveQueryOptions,
  LiveQueryUpdate,
  LiveQueryUpdateType,
  ResolvedLiveQueryOptions,
} from "./types.js";

export class WebSocketLiveQueryTransport implements LiveQueryTransport {
  #websocket: WebSocket | null = null;
  #url: string;
  #options: ResolvedLiveQueryOptions;
  #connectionState: LiveQueryConnectionState = "disconnected";
  #subscriptions = new Map<string, InternalSubscription>();
  #connectionStateListeners = new Set<
    (state: LiveQueryConnectionState) => void
  >();
  #errorListeners = new Set<(error: LiveQueryError) => void>();
  #reconnectAttempts = 0;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #subscriptionCounter = 0;
  #messageQueue: any[] = [];

  // Test-only property for accessing WebSocket in tests
  public __testWebSocket?: WebSocket | null;

  constructor(url: string, options: LiveQueryOptions = {}) {
    this.#url = url;
    this.#options = {
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectDelay: options.reconnectDelay ?? 1000,
      exponentialBackoff: options.exponentialBackoff ?? true,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      headers: options.headers ?? {},
      authToken: options.authToken,
      websocketUrl: options.websocketUrl,
      debug: options.debug ?? false,
    };

    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Initialized with options:",
        this.#options,
      );
    }
  }

  async connect(): Promise<void> {
    if (
      this.#connectionState === "connected" ||
      this.#connectionState === "connecting"
    ) {
      return;
    }

    this.#setConnectionState("connecting");

    try {
      await this.#createWebSocketConnection();
    } catch (error) {
      this.#setConnectionState("error");
      const liveError: LiveQueryError = {
        code: "CONNECTION_FAILED",
        message: `Failed to connect to live query service: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
        details: error,
      };
      this.#emitError(liveError);
      throw liveError;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    if (this.#websocket) {
      this.#websocket.close();
      this.#websocket = null;
    }

    // Clear all subscriptions
    this.#subscriptions.clear();
    this.#messageQueue = [];

    this.#setConnectionState("closed");
  }

  subscribe<T>(
    query: string,
    variables?: Record<string, any>,
    options?: LiveQueryOptions,
  ): LiveQuerySubscription<T> {
    const subscriptionId = `sub_${++this.#subscriptionCounter}_${Date.now()}`;
    const mergedOptions = { ...this.#options, ...options };

    const internalSub: InternalSubscription = {
      id: subscriptionId,
      query,
      variables: variables || {},
      options: mergedOptions,
      connectionState: this.#connectionState,
      data: undefined,
      error: undefined,
      loading: true,
      updateListeners: new Set(),
    };

    this.#subscriptions.set(subscriptionId, internalSub);

    // Send subscription message if connected
    if (this.#connectionState === "connected") {
      this.#sendSubscription(internalSub);
    } else {
      // Auto-connect if not already connecting
      if (this.#connectionState === "disconnected") {
        this.connect().catch((error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] Auto-connect failed:", error);
          }
        });
      }
    }

    return this.#createSubscriptionAPI(internalSub);
  }

  getConnectionState(): LiveQueryConnectionState {
    return this.#connectionState;
  }

  onConnectionStateChange(
    listener: (state: LiveQueryConnectionState) => void,
  ): () => void {
    this.#connectionStateListeners.add(listener);
    return () => this.#connectionStateListeners.delete(listener);
  }

  onError(listener: (error: LiveQueryError) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  #createWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.#websocket = new WebSocket(this.#url, "graphql-transport-ws");
        this.__testWebSocket = this.#websocket; // For testing

        let isConnectionEstablished = false;

        this.#websocket.onopen = () => {
          if (this.#options.debug) {
            console.log("[LiveQueryTransport] WebSocket connected");
          }
          // Send connection_init message to establish protocol
          this.#websocket?.send(
            JSON.stringify({
              type: "connection_init",
              payload: this.#options.headers || {},
            }),
          );
        };

        this.#websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Handle connection acknowledgement
            if (message.type === "connection_ack") {
              this.#setConnectionState("connected");
              this.#reconnectAttempts = 0;
              this.#processMessageQueue();
              isConnectionEstablished = true;
              resolve();
              return;
            }

            // Handle ping (respond with pong)
            if (message.type === "ping") {
              this.#websocket?.send(JSON.stringify({ type: "pong" }));
              return;
            }

            this.#handleMessage(message);
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to parse message:",
                error,
              );
            }
          }
        };

        this.#websocket.onclose = (event) => {
          if (this.#options.debug) {
            console.log(
              "[LiveQueryTransport] WebSocket closed:",
              event.code,
              event.reason,
            );
          }
          this.#websocket = null;
          this.__testWebSocket = null; // For testing

          if (!isConnectionEstablished) {
            reject(
              new Error(
                `WebSocket closed before connection established (Code: ${event.code})`,
              ),
            );
          }

          if (this.#connectionState !== "closed") {
            this.#setConnectionState("disconnected");
            this.#handleReconnection();
          }
        };

        this.#websocket.onerror = (error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] WebSocket error:", error);
          }
          reject(new Error("WebSocket connection failed"));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  #setConnectionState(state: LiveQueryConnectionState): void {
    if (this.#connectionState !== state) {
      this.#connectionState = state;

      // Update all subscription states
      for (const subscription of this.#subscriptions.values()) {
        subscription.connectionState = state;
      }

      // Notify listeners
      for (const listener of this.#connectionStateListeners) {
        try {
          listener(state);
        } catch (error) {
          if (this.#options.debug) {
            console.error(
              "[LiveQueryTransport] Connection state listener error:",
              error,
            );
          }
        }
      }
    }
  }

  #emitError(error: LiveQueryError): void {
    for (const listener of this.#errorListeners) {
      try {
        listener(error);
      } catch (listenerError) {
        if (this.#options.debug) {
          console.error(
            "[LiveQueryTransport] Error listener failed:",
            listenerError,
          );
        }
      }
    }
  }

  #handleReconnection(): void {
    if (
      !this.#options.autoReconnect ||
      this.#reconnectAttempts >= this.#options.maxReconnectAttempts
    ) {
      this.#setConnectionState("error");
      const error: LiveQueryError = {
        code: "MAX_RECONNECT_ATTEMPTS",
        message: `Failed to reconnect after ${this.#reconnectAttempts} attempts`,
        timestamp: new Date(),
      };
      this.#emitError(error);
      return;
    }

    this.#setConnectionState("reconnecting");
    this.#reconnectAttempts++;

    let delay = this.#options.reconnectDelay;
    if (this.#options.exponentialBackoff) {
      delay = Math.min(
        delay * Math.pow(2, this.#reconnectAttempts - 1),
        this.#options.maxReconnectDelay,
      );
    }

    if (this.#options.debug) {
      console.log(
        `[LiveQueryTransport] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`,
      );
    }

    this.#reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Reconnection failed:", error);
        }
      });
    }, delay);
  }

  #processMessageQueue(): void {
    while (this.#messageQueue.length > 0) {
      const message = this.#messageQueue.shift();
      if (message?.type === "subscribe") {
        this.#sendSubscription(message.subscription);
      }
    }
  }

  #sendSubscription(subscription: InternalSubscription): void {
    if (this.#options.debug) {
      console.log('[LiveQueryTransport] Sending query:', subscription.query);
    }
    if (!this.#websocket || this.#websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: "subscribe",
      id: subscription.id,
      payload: {
        query: subscription.query,
        variables: subscription.variables,
      },
    };

    try {
      this.#websocket.send(JSON.stringify(message));
      if (this.#options.debug) {
        console.log("[LiveQueryTransport] Sent subscription:", subscription.id);
      }
    } catch (error) {
      if (this.#options.debug) {
        console.error(
          "[LiveQueryTransport] Failed to send subscription:",
          error,
        );
      }
    }
  }

  #handleMessage(message: any): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Received message:", message);
    }

    const { type, id, payload } = message;
    const subscription = this.#subscriptions.get(id);

    if (!subscription) {
      if (this.#options.debug) {
        console.warn(
          "[LiveQueryTransport] Received message for unknown subscription:",
          id,
        );
      }
      return;
    }

    switch (type) {
      case "next": // New protocol uses 'next'
      case "data": // Fallback
        this.#handleDataMessage(subscription, payload);
        break;
      case "error":
        this.#handleErrorMessage(subscription, payload);
        break;
      case "complete":
        this.#handleCompleteMessage(subscription);
        break;
      case "update":
        this.#handleUpdateMessage(subscription, payload);
        break;
      default:
        if (this.#options.debug) {
          console.warn("[LiveQueryTransport] Unknown message type:", type);
        }
    }
  }

  #handleDataMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.log('[LiveQueryTransport] Received data for subscription:', subscription.id, payload);
    }
    subscription.loading = false;
    subscription.error = undefined;

    // Extract the actual query result from the GraphQL response
    // GraphQL responses are structured as { data: { fieldName: result } }
    // We need to extract the first field's value as that's the actual result
    let resultData = payload.data;
    if (
      resultData &&
      typeof resultData === "object" &&
      !Array.isArray(resultData)
    ) {
      const keys = Object.keys(resultData);
      if (keys.length === 1 && keys[0]) {
        resultData = resultData[keys[0]];
      }
    }

    subscription.data = resultData;

    // Notify update listeners
    // If it's a 'next' message, it might be a standard GraphQL result
    // We treat it as a refresh/update
    const update: LiveQueryUpdate = {
      type: "refresh",
      result: resultData,
      timestamp: new Date(),
      metadata: payload.extensions,
    };

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #handleErrorMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.error(
        "[LiveQueryTransport] Subscription error payload:",
        payload,
      );
    }

    subscription.loading = false;
    subscription.error = {
      code: payload[0]?.extensions?.code || "QUERY_ERROR",
      message: payload[0]?.message || "Query execution failed",
      timestamp: new Date(),
      details: payload,
    };

    this.#notifySubscriptionUpdate(subscription, {
      type: "refresh",
      timestamp: new Date(),
    });
  }

  #handleCompleteMessage(subscription: InternalSubscription): void {
    subscription.loading = false;
    // Subscription completed - this is normal for live queries
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Subscription completed:",
        subscription.id,
      );
    }
  }

  #handleUpdateMessage(subscription: InternalSubscription, payload: any): void {
    const updateType = payload.updateType as LiveQueryUpdateType;
    const update: LiveQueryUpdate = {
      type: updateType,
      data: payload.data,
      result: payload.result,
      timestamp: new Date(payload.timestamp),
      metadata: payload.metadata,
    };

    // Update local data based on update type
    if (
      updateType === "refresh" ||
      updateType === "insert" ||
      updateType === "update"
    ) {
      subscription.data = payload.result || payload.data;
    }

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #notifySubscriptionUpdate(
    subscription: InternalSubscription,
    update: LiveQueryUpdate,
  ): void {
    for (const listener of subscription.updateListeners) {
      try {
        listener(update);
      } catch (error) {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Update listener error:", error);
        }
      }
    }
  }

  #createSubscriptionAPI<T>(
    internal: InternalSubscription,
  ): LiveQuerySubscription<T> {
    return {
      id: internal.id,
      query: internal.query,
      variables: internal.variables,
      get connectionState(): LiveQueryConnectionState {
        return internal.connectionState;
      },
      get data(): T | undefined {
        return internal.data as T | undefined;
      },
      get error(): LiveQueryError | undefined {
        return internal.error;
      },
      get loading(): boolean {
        return internal.loading;
      },
      unsubscribe: () => {
        this.#subscriptions.delete(internal.id);

        if (this.#websocket && this.#websocket.readyState === WebSocket.OPEN) {
          try {
            this.#websocket.send(
              JSON.stringify({
                type: "complete", // Protocol uses 'complete' to stop subscription
                id: internal.id,
              }),
            );
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to send unsubscribe:",
                error,
              );
            }
          }
        }
      },
      refetch: async () => {
        if (this.#connectionState === "connected") {
          internal.loading = true;
          this.#sendSubscription(internal);
        } else {
          throw new Error("Cannot refetch: not connected");
        }
      },
      onUpdate: (callback: (update: LiveQueryUpdate) => void) => {
        internal.updateListeners.add(callback);

        // Immediately invoke callback if data is already available (handles race conditions)
        if (internal.data !== undefined) {
          try {
            callback({
              type: "refresh",
              result: internal.data,
              timestamp: new Date(),
            });
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] onUpdate callback error:",
                error,
              );
            }
          }
        }

        return () => {
          internal.updateListeners.delete(callback);
        };
      },
    };
  }
}

// Internal subscription representation
interface InternalSubscription {
  id: string;
  query: string;
  variables: Record<string, any>;
  options: ResolvedLiveQueryOptions;
  connectionState: LiveQueryConnectionState;
  data: any;
  error: LiveQueryError | undefined;
  loading: boolean;
  updateListeners: Set<(update: LiveQueryUpdate) => void>;
}

// Export default transport instance
export const defaultLiveQueryTransport = (
  url: string,
  options?: LiveQueryOptions,
) => new WebSocketLiveQueryTransport(url, options);

// Test accessor for private WebSocket field (only for testing)
declare global {
  interface Window {
    __TEST_MODE__?: boolean;
  }
}

```


**Tool Call: src/live/transport.ts:             // Handle connecti... =>             // Handle connecti...**
Status: Completed

Diff: transport.ts
```
/**
 * WebSocket-based transport layer for live queries
 * Implements the LiveQueryTransport interface using WebSocket connections
 */

import {
  LiveQueryTransport,
  LiveQuerySubscription,
  LiveQueryConnectionState,
  LiveQueryError,
  LiveQueryOptions,
  LiveQueryUpdate,
  LiveQueryUpdateType,
  ResolvedLiveQueryOptions,
} from "./types.js";

export class WebSocketLiveQueryTransport implements LiveQueryTransport {
  #websocket: WebSocket | null = null;
  #url: string;
  #options: ResolvedLiveQueryOptions;
  #connectionState: LiveQueryConnectionState = "disconnected";
  #subscriptions = new Map<string, InternalSubscription>();
  #connectionStateListeners = new Set<
    (state: LiveQueryConnectionState) => void
  >();
  #errorListeners = new Set<(error: LiveQueryError) => void>();
  #reconnectAttempts = 0;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #subscriptionCounter = 0;
  #messageQueue: any[] = [];

  // Test-only property for accessing WebSocket in tests
  public __testWebSocket?: WebSocket | null;

  constructor(url: string, options: LiveQueryOptions = {}) {
    this.#url = url;
    this.#options = {
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectDelay: options.reconnectDelay ?? 1000,
      exponentialBackoff: options.exponentialBackoff ?? true,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      headers: options.headers ?? {},
      authToken: options.authToken,
      websocketUrl: options.websocketUrl,
      debug: options.debug ?? false,
    };

    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Initialized with options:",
        this.#options,
      );
    }
  }

  async connect(): Promise<void> {
    if (
      this.#connectionState === "connected" ||
      this.#connectionState === "connecting"
    ) {
      return;
    }

    this.#setConnectionState("connecting");

    try {
      await this.#createWebSocketConnection();
    } catch (error) {
      this.#setConnectionState("error");
      const liveError: LiveQueryError = {
        code: "CONNECTION_FAILED",
        message: `Failed to connect to live query service: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
        details: error,
      };
      this.#emitError(liveError);
      throw liveError;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    if (this.#websocket) {
      this.#websocket.close();
      this.#websocket = null;
    }

    // Clear all subscriptions
    this.#subscriptions.clear();
    this.#messageQueue = [];

    this.#setConnectionState("closed");
  }

  subscribe<T>(
    query: string,
    variables?: Record<string, any>,
    options?: LiveQueryOptions,
  ): LiveQuerySubscription<T> {
    const subscriptionId = `sub_${++this.#subscriptionCounter}_${Date.now()}`;
    const mergedOptions = { ...this.#options, ...options };

    const internalSub: InternalSubscription = {
      id: subscriptionId,
      query,
      variables: variables || {},
      options: mergedOptions,
      connectionState: this.#connectionState,
      data: undefined,
      error: undefined,
      loading: true,
      updateListeners: new Set(),
    };

    this.#subscriptions.set(subscriptionId, internalSub);

    // Send subscription message if connected
    if (this.#connectionState === "connected") {
      this.#sendSubscription(internalSub);
    } else {
      // Auto-connect if not already connecting
      if (this.#connectionState === "disconnected") {
        this.connect().catch((error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] Auto-connect failed:", error);
          }
        });
      }
    }

    return this.#createSubscriptionAPI(internalSub);
  }

  getConnectionState(): LiveQueryConnectionState {
    return this.#connectionState;
  }

  onConnectionStateChange(
    listener: (state: LiveQueryConnectionState) => void,
  ): () => void {
    this.#connectionStateListeners.add(listener);
    return () => this.#connectionStateListeners.delete(listener);
  }

  onError(listener: (error: LiveQueryError) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  #createWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.#websocket = new WebSocket(this.#url, "graphql-transport-ws");
        this.__testWebSocket = this.#websocket; // For testing

        let isConnectionEstablished = false;

        this.#websocket.onopen = () => {
          if (this.#options.debug) {
            console.log("[LiveQueryTransport] WebSocket connected");
          }
          // Send connection_init message to establish protocol
          this.#websocket?.send(
            JSON.stringify({
              type: "connection_init",
              payload: this.#options.headers || {},
            }),
          );
        };

        this.#websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Handle connection acknowledgement
            if (message.type === "connection_ack") {
              this.#setConnectionState("connected");
              this.#reconnectAttempts = 0;
              this.#processMessageQueue();
              this.#resubscribeAll();
              isConnectionEstablished = true;
              resolve();
              return;
            }

            // Handle ping (respond with pong)
            if (message.type === "ping") {
              this.#websocket?.send(JSON.stringify({ type: "pong" }));
              return;
            }

            this.#handleMessage(message);
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to parse message:",
                error,
              );
            }
          }
        };

        this.#websocket.onclose = (event) => {
          if (this.#options.debug) {
            console.log(
              "[LiveQueryTransport] WebSocket closed:",
              event.code,
              event.reason,
            );
          }
          this.#websocket = null;
          this.__testWebSocket = null; // For testing

          if (!isConnectionEstablished) {
            reject(
              new Error(
                `WebSocket closed before connection established (Code: ${event.code})`,
              ),
            );
          }

          if (this.#connectionState !== "closed") {
            this.#setConnectionState("disconnected");
            this.#handleReconnection();
          }
        };

        this.#websocket.onerror = (error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] WebSocket error:", error);
          }
          reject(new Error("WebSocket connection failed"));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  #setConnectionState(state: LiveQueryConnectionState): void {
    if (this.#connectionState !== state) {
      this.#connectionState = state;

      // Update all subscription states
      for (const subscription of this.#subscriptions.values()) {
        subscription.connectionState = state;
      }

      // Notify listeners
      for (const listener of this.#connectionStateListeners) {
        try {
          listener(state);
        } catch (error) {
          if (this.#options.debug) {
            console.error(
              "[LiveQueryTransport] Connection state listener error:",
              error,
            );
          }
        }
      }
    }
  }

  #emitError(error: LiveQueryError): void {
    for (const listener of this.#errorListeners) {
      try {
        listener(error);
      } catch (listenerError) {
        if (this.#options.debug) {
          console.error(
            "[LiveQueryTransport] Error listener failed:",
            listenerError,
          );
        }
      }
    }
  }

  #handleReconnection(): void {
    if (
      !this.#options.autoReconnect ||
      this.#reconnectAttempts >= this.#options.maxReconnectAttempts
    ) {
      this.#setConnectionState("error");
      const error: LiveQueryError = {
        code: "MAX_RECONNECT_ATTEMPTS",
        message: `Failed to reconnect after ${this.#reconnectAttempts} attempts`,
        timestamp: new Date(),
      };
      this.#emitError(error);
      return;
    }

    this.#setConnectionState("reconnecting");
    this.#reconnectAttempts++;

    let delay = this.#options.reconnectDelay;
    if (this.#options.exponentialBackoff) {
      delay = Math.min(
        delay * Math.pow(2, this.#reconnectAttempts - 1),
        this.#options.maxReconnectDelay,
      );
    }

    if (this.#options.debug) {
      console.log(
        `[LiveQueryTransport] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`,
      );
    }

    this.#reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Reconnection failed:", error);
        }
      });
    }, delay);
  }

  #processMessageQueue(): void {
    while (this.#messageQueue.length > 0) {
      const message = this.#messageQueue.shift();
      if (message?.type === "subscribe") {
        this.#sendSubscription(message.subscription);
      }
    }
  }

  #sendSubscription(subscription: InternalSubscription): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Sending query:", subscription.query);
    }
    if (!this.#websocket || this.#websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: "subscribe",
      id: subscription.id,
      payload: {
        query: subscription.query,
        variables: subscription.variables,
      },
    };

    try {
      this.#websocket.send(JSON.stringify(message));
      if (this.#options.debug) {
        console.log("[LiveQueryTransport] Sent subscription:", subscription.id);
      }
    } catch (error) {
      if (this.#options.debug) {
        console.error(
          "[LiveQueryTransport] Failed to send subscription:",
          error,
        );
      }
    }
  }

  #handleMessage(message: any): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Received message:", message);
    }

    const { type, id, payload } = message;
    const subscription = this.#subscriptions.get(id);

    if (!subscription) {
      if (this.#options.debug) {
        console.warn(
          "[LiveQueryTransport] Received message for unknown subscription:",
          id,
        );
      }
      return;
    }

    switch (type) {
      case "next": // New protocol uses 'next'
      case "data": // Fallback
        this.#handleDataMessage(subscription, payload);
        break;
      case "error":
        this.#handleErrorMessage(subscription, payload);
        break;
      case "complete":
        this.#handleCompleteMessage(subscription);
        break;
      case "update":
        this.#handleUpdateMessage(subscription, payload);
        break;
      default:
        if (this.#options.debug) {
          console.warn("[LiveQueryTransport] Unknown message type:", type);
        }
    }
  }

  #handleDataMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Received data for subscription:",
        subscription.id,
        payload,
      );
    }
    subscription.loading = false;
    subscription.error = undefined;

    // Extract the actual query result from the GraphQL response
    // GraphQL responses are structured as { data: { fieldName: result } }
    // We need to extract the first field's value as that's the actual result
    let resultData = payload.data;
    if (
      resultData &&
      typeof resultData === "object" &&
      !Array.isArray(resultData)
    ) {
      const keys = Object.keys(resultData);
      if (keys.length === 1 && keys[0]) {
        resultData = resultData[keys[0]];
      }
    }

    subscription.data = resultData;

    // Notify update listeners
    // If it's a 'next' message, it might be a standard GraphQL result
    // We treat it as a refresh/update
    const update: LiveQueryUpdate = {
      type: "refresh",
      result: resultData,
      timestamp: new Date(),
      metadata: payload.extensions,
    };

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #handleErrorMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.error(
        "[LiveQueryTransport] Subscription error payload:",
        payload,
      );
    }

    subscription.loading = false;
    subscription.error = {
      code: payload[0]?.extensions?.code || "QUERY_ERROR",
      message: payload[0]?.message || "Query execution failed",
      timestamp: new Date(),
      details: payload,
    };

    this.#notifySubscriptionUpdate(subscription, {
      type: "refresh",
      timestamp: new Date(),
    });
  }

  #handleCompleteMessage(subscription: InternalSubscription): void {
    subscription.loading = false;
    // Subscription completed - this is normal for live queries
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Subscription completed:",
        subscription.id,
      );
    }
  }

  #handleUpdateMessage(subscription: InternalSubscription, payload: any): void {
    const updateType = payload.updateType as LiveQueryUpdateType;
    const update: LiveQueryUpdate = {
      type: updateType,
      data: payload.data,
      result: payload.result,
      timestamp: new Date(payload.timestamp),
      metadata: payload.metadata,
    };

    // Update local data based on update type
    if (
      updateType === "refresh" ||
      updateType === "insert" ||
      updateType === "update"
    ) {
      subscription.data = payload.result || payload.data;
    }

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #notifySubscriptionUpdate(
    subscription: InternalSubscription,
    update: LiveQueryUpdate,
  ): void {
    for (const listener of subscription.updateListeners) {
      try {
        listener(update);
      } catch (error) {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Update listener error:", error);
        }
      }
    }
  }

  #createSubscriptionAPI<T>(
    internal: InternalSubscription,
  ): LiveQuerySubscription<T> {
    return {
      id: internal.id,
      query: internal.query,
      variables: internal.variables,
      get connectionState(): LiveQueryConnectionState {
        return internal.connectionState;
      },
      get data(): T | undefined {
        return internal.data as T | undefined;
      },
      get error(): LiveQueryError | undefined {
        return internal.error;
      },
      get loading(): boolean {
        return internal.loading;
      },
      unsubscribe: () => {
        this.#subscriptions.delete(internal.id);

        if (this.#websocket && this.#websocket.readyState === WebSocket.OPEN) {
          try {
            this.#websocket.send(
              JSON.stringify({
                type: "complete", // Protocol uses 'complete' to stop subscription
                id: internal.id,
              }),
            );
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to send unsubscribe:",
                error,
              );
            }
          }
        }
      },
      refetch: async () => {
        if (this.#connectionState === "connected") {
          internal.loading = true;
          this.#sendSubscription(internal);
        } else {
          throw new Error("Cannot refetch: not connected");
        }
      },
      onUpdate: (callback: (update: LiveQueryUpdate) => void) => {
        internal.updateListeners.add(callback);

        // Immediately invoke callback if data is already available (handles race conditions)
        if (internal.data !== undefined) {
          try {
            callback({
              type: "refresh",
              result: internal.data,
              timestamp: new Date(),
            });
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] onUpdate callback error:",
                error,
              );
            }
          }
        }

        return () => {
          internal.updateListeners.delete(callback);
        };
      },
    };
  }
}

// Internal subscription representation
interface InternalSubscription {
  id: string;
  query: string;
  variables: Record<string, any>;
  options: ResolvedLiveQueryOptions;
  connectionState: LiveQueryConnectionState;
  data: any;
  error: LiveQueryError | undefined;
  loading: boolean;
  updateListeners: Set<(update: LiveQueryUpdate) => void>;
}

// Export default transport instance
export const defaultLiveQueryTransport = (
  url: string,
  options?: LiveQueryOptions,
) => new WebSocketLiveQueryTransport(url, options);

// Test accessor for private WebSocket field (only for testing)
declare global {
  interface Window {
    __TEST_MODE__?: boolean;
  }
}

```


**Tool Call: src/live/transport.ts:   #handleReconnection(): void ... =>   #handleReconnection(): void ...**
Status: Completed

Diff: transport.ts
```
/**
 * WebSocket-based transport layer for live queries
 * Implements the LiveQueryTransport interface using WebSocket connections
 */

import {
  LiveQueryTransport,
  LiveQuerySubscription,
  LiveQueryConnectionState,
  LiveQueryError,
  LiveQueryOptions,
  LiveQueryUpdate,
  LiveQueryUpdateType,
  ResolvedLiveQueryOptions,
} from "./types.js";

export class WebSocketLiveQueryTransport implements LiveQueryTransport {
  #websocket: WebSocket | null = null;
  #url: string;
  #options: ResolvedLiveQueryOptions;
  #connectionState: LiveQueryConnectionState = "disconnected";
  #subscriptions = new Map<string, InternalSubscription>();
  #connectionStateListeners = new Set<
    (state: LiveQueryConnectionState) => void
  >();
  #errorListeners = new Set<(error: LiveQueryError) => void>();
  #reconnectAttempts = 0;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #subscriptionCounter = 0;
  #messageQueue: any[] = [];

  // Test-only property for accessing WebSocket in tests
  public __testWebSocket?: WebSocket | null;

  constructor(url: string, options: LiveQueryOptions = {}) {
    this.#url = url;
    this.#options = {
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectDelay: options.reconnectDelay ?? 1000,
      exponentialBackoff: options.exponentialBackoff ?? true,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      headers: options.headers ?? {},
      authToken: options.authToken,
      websocketUrl: options.websocketUrl,
      debug: options.debug ?? false,
    };

    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Initialized with options:",
        this.#options,
      );
    }
  }

  async connect(): Promise<void> {
    if (
      this.#connectionState === "connected" ||
      this.#connectionState === "connecting"
    ) {
      return;
    }

    this.#setConnectionState("connecting");

    try {
      await this.#createWebSocketConnection();
    } catch (error) {
      this.#setConnectionState("error");
      const liveError: LiveQueryError = {
        code: "CONNECTION_FAILED",
        message: `Failed to connect to live query service: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
        details: error,
      };
      this.#emitError(liveError);
      throw liveError;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    if (this.#websocket) {
      this.#websocket.close();
      this.#websocket = null;
    }

    // Clear all subscriptions
    this.#subscriptions.clear();
    this.#messageQueue = [];

    this.#setConnectionState("closed");
  }

  subscribe<T>(
    query: string,
    variables?: Record<string, any>,
    options?: LiveQueryOptions,
  ): LiveQuerySubscription<T> {
    const subscriptionId = `sub_${++this.#subscriptionCounter}_${Date.now()}`;
    const mergedOptions = { ...this.#options, ...options };

    const internalSub: InternalSubscription = {
      id: subscriptionId,
      query,
      variables: variables || {},
      options: mergedOptions,
      connectionState: this.#connectionState,
      data: undefined,
      error: undefined,
      loading: true,
      updateListeners: new Set(),
    };

    this.#subscriptions.set(subscriptionId, internalSub);

    // Send subscription message if connected
    if (this.#connectionState === "connected") {
      this.#sendSubscription(internalSub);
    } else {
      // Auto-connect if not already connecting
      if (this.#connectionState === "disconnected") {
        this.connect().catch((error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] Auto-connect failed:", error);
          }
        });
      }
    }

    return this.#createSubscriptionAPI(internalSub);
  }

  getConnectionState(): LiveQueryConnectionState {
    return this.#connectionState;
  }

  onConnectionStateChange(
    listener: (state: LiveQueryConnectionState) => void,
  ): () => void {
    this.#connectionStateListeners.add(listener);
    return () => this.#connectionStateListeners.delete(listener);
  }

  onError(listener: (error: LiveQueryError) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  #createWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.#websocket = new WebSocket(this.#url, "graphql-transport-ws");
        this.__testWebSocket = this.#websocket; // For testing

        let isConnectionEstablished = false;

        this.#websocket.onopen = () => {
          if (this.#options.debug) {
            console.log("[LiveQueryTransport] WebSocket connected");
          }
          // Send connection_init message to establish protocol
          this.#websocket?.send(
            JSON.stringify({
              type: "connection_init",
              payload: this.#options.headers || {},
            }),
          );
        };

        this.#websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Handle connection acknowledgement
            if (message.type === "connection_ack") {
              this.#setConnectionState("connected");
              this.#reconnectAttempts = 0;
              this.#processMessageQueue();
              this.#resubscribeAll();
              isConnectionEstablished = true;
              resolve();
              return;
            }

            // Handle ping (respond with pong)
            if (message.type === "ping") {
              this.#websocket?.send(JSON.stringify({ type: "pong" }));
              return;
            }

            this.#handleMessage(message);
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to parse message:",
                error,
              );
            }
          }
        };

        this.#websocket.onclose = (event) => {
          if (this.#options.debug) {
            console.log(
              "[LiveQueryTransport] WebSocket closed:",
              event.code,
              event.reason,
            );
          }
          this.#websocket = null;
          this.__testWebSocket = null; // For testing

          if (!isConnectionEstablished) {
            reject(
              new Error(
                `WebSocket closed before connection established (Code: ${event.code})`,
              ),
            );
          }

          if (this.#connectionState !== "closed") {
            this.#setConnectionState("disconnected");
            this.#handleReconnection();
          }
        };

        this.#websocket.onerror = (error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] WebSocket error:", error);
          }
          reject(new Error("WebSocket connection failed"));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  #setConnectionState(state: LiveQueryConnectionState): void {
    if (this.#connectionState !== state) {
      this.#connectionState = state;

      // Update all subscription states
      for (const subscription of this.#subscriptions.values()) {
        subscription.connectionState = state;
      }

      // Notify listeners
      for (const listener of this.#connectionStateListeners) {
        try {
          listener(state);
        } catch (error) {
          if (this.#options.debug) {
            console.error(
              "[LiveQueryTransport] Connection state listener error:",
              error,
            );
          }
        }
      }
    }
  }

  #emitError(error: LiveQueryError): void {
    for (const listener of this.#errorListeners) {
      try {
        listener(error);
      } catch (listenerError) {
        if (this.#options.debug) {
          console.error(
            "[LiveQueryTransport] Error listener failed:",
            listenerError,
          );
        }
      }
    }
  }

  #handleReconnection(): void {
    if (
      !this.#options.autoReconnect ||
      this.#reconnectAttempts >= this.#options.maxReconnectAttempts
    ) {
      this.#setConnectionState("error");
      const error: LiveQueryError = {
        code: "MAX_RECONNECT_ATTEMPTS",
        message: `Failed to reconnect after ${this.#reconnectAttempts} attempts`,
        timestamp: new Date(),
      };
      this.#emitError(error);
      return;
    }

    this.#setConnectionState("reconnecting");
    this.#reconnectAttempts++;

    let delay = this.#options.reconnectDelay;
    if (this.#options.exponentialBackoff) {
      delay = Math.min(
        delay * Math.pow(2, this.#reconnectAttempts - 1),
        this.#options.maxReconnectDelay,
      );
    }

    if (this.#options.debug) {
      console.log(
        `[LiveQueryTransport] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`,
      );
    }

    this.#reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Reconnection failed:", error);
        }
      });
    }, delay);
  }

  #resubscribeAll(): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Resubscribing all active subscriptions");
    }
    for (const subscription of this.#subscriptions.values()) {
      if (subscription.options.refetchOnReconnect !== false) {
        this.#sendSubscription(subscription);
      }
    }
  }

  #processMessageQueue(): void {
    while (this.#messageQueue.length > 0) {
      const message = this.#messageQueue.shift();
      if (message?.type === "subscribe") {
        this.#sendSubscription(message.subscription);
      }
    }
  }

  #sendSubscription(subscription: InternalSubscription): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Sending query:", subscription.query);
    }
    if (!this.#websocket || this.#websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: "subscribe",
      id: subscription.id,
      payload: {
        query: subscription.query,
        variables: subscription.variables,
      },
    };

    try {
      this.#websocket.send(JSON.stringify(message));
      if (this.#options.debug) {
        console.log("[LiveQueryTransport] Sent subscription:", subscription.id);
      }
    } catch (error) {
      if (this.#options.debug) {
        console.error(
          "[LiveQueryTransport] Failed to send subscription:",
          error,
        );
      }
    }
  }

  #handleMessage(message: any): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Received message:", message);
    }

    const { type, id, payload } = message;
    const subscription = this.#subscriptions.get(id);

    if (!subscription) {
      if (this.#options.debug) {
        console.warn(
          "[LiveQueryTransport] Received message for unknown subscription:",
          id,
        );
      }
      return;
    }

    switch (type) {
      case "next": // New protocol uses 'next'
      case "data": // Fallback
        this.#handleDataMessage(subscription, payload);
        break;
      case "error":
        this.#handleErrorMessage(subscription, payload);
        break;
      case "complete":
        this.#handleCompleteMessage(subscription);
        break;
      case "update":
        this.#handleUpdateMessage(subscription, payload);
        break;
      default:
        if (this.#options.debug) {
          console.warn("[LiveQueryTransport] Unknown message type:", type);
        }
    }
  }

  #handleDataMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Received data for subscription:",
        subscription.id,
        payload,
      );
    }
    subscription.loading = false;
    subscription.error = undefined;

    // Extract the actual query result from the GraphQL response
    // GraphQL responses are structured as { data: { fieldName: result } }
    // We need to extract the first field's value as that's the actual result
    let resultData = payload.data;
    if (
      resultData &&
      typeof resultData === "object" &&
      !Array.isArray(resultData)
    ) {
      const keys = Object.keys(resultData);
      if (keys.length === 1 && keys[0]) {
        resultData = resultData[keys[0]];
      }
    }

    subscription.data = resultData;

    // Notify update listeners
    // If it's a 'next' message, it might be a standard GraphQL result
    // We treat it as a refresh/update
    const update: LiveQueryUpdate = {
      type: "refresh",
      result: resultData,
      timestamp: new Date(),
      metadata: payload.extensions,
    };

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #handleErrorMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.error(
        "[LiveQueryTransport] Subscription error payload:",
        payload,
      );
    }

    subscription.loading = false;
    subscription.error = {
      code: payload[0]?.extensions?.code || "QUERY_ERROR",
      message: payload[0]?.message || "Query execution failed",
      timestamp: new Date(),
      details: payload,
    };

    this.#notifySubscriptionUpdate(subscription, {
      type: "refresh",
      timestamp: new Date(),
    });
  }

  #handleCompleteMessage(subscription: InternalSubscription): void {
    subscription.loading = false;
    // Subscription completed - this is normal for live queries
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Subscription completed:",
        subscription.id,
      );
    }
  }

  #handleUpdateMessage(subscription: InternalSubscription, payload: any): void {
    const updateType = payload.updateType as LiveQueryUpdateType;
    const update: LiveQueryUpdate = {
      type: updateType,
      data: payload.data,
      result: payload.result,
      timestamp: new Date(payload.timestamp),
      metadata: payload.metadata,
    };

    // Update local data based on update type
    if (
      updateType === "refresh" ||
      updateType === "insert" ||
      updateType === "update"
    ) {
      subscription.data = payload.result || payload.data;
    }

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #notifySubscriptionUpdate(
    subscription: InternalSubscription,
    update: LiveQueryUpdate,
  ): void {
    for (const listener of subscription.updateListeners) {
      try {
        listener(update);
      } catch (error) {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Update listener error:", error);
        }
      }
    }
  }

  #createSubscriptionAPI<T>(
    internal: InternalSubscription,
  ): LiveQuerySubscription<T> {
    return {
      id: internal.id,
      query: internal.query,
      variables: internal.variables,
      get connectionState(): LiveQueryConnectionState {
        return internal.connectionState;
      },
      get data(): T | undefined {
        return internal.data as T | undefined;
      },
      get error(): LiveQueryError | undefined {
        return internal.error;
      },
      get loading(): boolean {
        return internal.loading;
      },
      unsubscribe: () => {
        this.#subscriptions.delete(internal.id);

        if (this.#websocket && this.#websocket.readyState === WebSocket.OPEN) {
          try {
            this.#websocket.send(
              JSON.stringify({
                type: "complete", // Protocol uses 'complete' to stop subscription
                id: internal.id,
              }),
            );
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to send unsubscribe:",
                error,
              );
            }
          }
        }
      },
      refetch: async () => {
        if (this.#connectionState === "connected") {
          internal.loading = true;
          this.#sendSubscription(internal);
        } else {
          throw new Error("Cannot refetch: not connected");
        }
      },
      onUpdate: (callback: (update: LiveQueryUpdate) => void) => {
        internal.updateListeners.add(callback);

        // Immediately invoke callback if data is already available (handles race conditions)
        if (internal.data !== undefined) {
          try {
            callback({
              type: "refresh",
              result: internal.data,
              timestamp: new Date(),
            });
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] onUpdate callback error:",
                error,
              );
            }
          }
        }

        return () => {
          internal.updateListeners.delete(callback);
        };
      },
    };
  }
}

// Internal subscription representation
interface InternalSubscription {
  id: string;
  query: string;
  variables: Record<string, any>;
  options: ResolvedLiveQueryOptions;
  connectionState: LiveQueryConnectionState;
  data: any;
  error: LiveQueryError | undefined;
  loading: boolean;
  updateListeners: Set<(update: LiveQueryUpdate) => void>;
}

// Export default transport instance
export const defaultLiveQueryTransport = (
  url: string,
  options?: LiveQueryOptions,
) => new WebSocketLiveQueryTransport(url, options);

// Test accessor for private WebSocket field (only for testing)
declare global {
  interface Window {
    __TEST_MODE__?: boolean;
  }
}

```


## Assistant

<thinking>
**Debugging Replace Calls**

I've successfully debugged the initial `replace` call, splitting it into smaller, manageable steps to address the previous error. The remaining three calls executed without issue. My immediate next step is now updating `src/react/useLiveQuery.ts` to improve efficiency by removing a redundant element.


**Assessing Refetch Logic**

I've streamlined the `useEffect` hook in `useLiveQuery.ts`, removing the conditional refetch logic. I then verified the `connectionState` updates correctly, making sure the hook still handles unmounting safely. Now, I'm reviewing the logs, particularly the immediate `complete` message, to ensure nothing is missed in the transition.


**Evaluating `complete` Messages**

I'm now investigating the backend's `complete` messages. The logs suggest the backend might be completing the subscription prematurely. I'm reviewing the interplay between `transport.ts`'s `unsubscribe` and the backend's behavior. I will check for the edge cases of quick unmounting/remounting scenarios, especially in React Strict Mode. My core question is what triggers the backend `complete` call.


**Addressing Early Completions**

I'm now focusing on the unexpected `complete` messages received from the backend, specifically tied to the initial subscription ID. Examining the logs reveals a pattern: the 'complete' message appears *after* the initial error and during the reconnect. This leads me to believe the server might be closing these subscriptions. I am now looking at the conditions of the reconnection strategy. This explains the reuse of old IDs.


**Unraveling Completion Mysteries**

After refining `src/react/useLiveQuery.ts` and confirming unmounting logic, I'm now focused on those pesky backend `complete` messages. I'm investigating why the backend might prematurely close a subscription, particularly the timing of these events with initial errors and reconnections. My hypothesis centers around the server potentially closing subscriptions due to issues or quick unmount/remount scenarios.


**Revisiting Refetch Behavior**

I'm now investigating refetching within `transport.ts`, specifically how `undefined` values from user-provided options affect the `refetchOnReconnect` setting. I've pinpointed a potential issue where explicitly providing `undefined` for `refetchOnReconnect` overrides the default, which isn't the intended behavior. I'll need to update the transport's option merging strategy.


**Refactoring `useEffect` Hook**

Now, I've eliminated the conditional refetch within the `useEffect` hook of `src/react/useLiveQuery.ts`, and verified that the `connectionState` updates correctly, including unmounting safety. The next step is to examine the unexpected `complete` messages in the logs and their relationship to unmounting, remounting and connection issues, to understand the trigger.


**Streamlining Connection Logic**

I'm removing the conditional refetch logic from `src/react/useLiveQuery.ts` and verifying `connectionState` updates correctly, accounting for unmounting safety. The goal now is to track down the root cause of the unexpected `complete` messages. I'm focusing on their timing relative to initial errors, unmounts/remounts and any connection issues.



</thinking>

I will modify `src/react/useLiveQuery.ts` to remove the redundant manual refetching logic from the connection state change listener. This ensures that `useLiveQuery` relies on the `transport` layer's automatic resubscription mechanism, preventing duplicate subscriptions and race conditions.



**Tool Call: src/react/useLiveQuery.ts:   // Handle connection state c... =>   // Handle connection state c...**
Status: Completed

Diff: useLiveQuery.ts
```
/**
 * React hook for live data fetching using GraphQL queries with @live directive
 * Provides seamless integration between ORM-style queries and live data updates
 */

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { buildQueryFromFunction } from "../query-builder.js";
import { useLiveQueryContext } from "./LiveQueryProvider.js";
import {
  LiveQueryHookResult,
  LiveQuerySubscription,
  LiveQueryError,
  LiveQueryUpdate,
  LiveQueryOptions,
} from "../live/types.js";
import { QueryFunction } from "../types/orm.js";

export interface UseLiveQueryOptions extends LiveQueryOptions {
  /**
   * Whether to suspend the query execution
   * @default false
   */
  suspend?: boolean;

  /**
   * Whether to refetch on reconnect
   * @default true
   */
  refetchOnReconnect?: boolean;

  /**
   * Whether to use cached results when available
   * @default true
   */
  useCache?: boolean;

  /**
   * Custom error handler
   */
  onError?: (error: LiveQueryError) => void;

  /**
   * Custom update handler
   */
  onUpdate?: (update: LiveQueryUpdate) => void;

  /**
   * Dependencies that should trigger a refetch when changed
   */
  dependencies?: any[];
}

/**
 * Hook to execute live GraphQL queries with real-time updates
 */
export function useLiveQuery<T>(
  queryFn: QueryFunction<T>,
  options: UseLiveQueryOptions = {},
): LiveQueryHookResult<T> {
  const context = useLiveQueryContext();
  const { transport, cache } = context;

  if (!transport) {
    throw new Error(
      "useLiveQuery requires a transport instance in LiveQueryProvider",
    );
  }
  
  // Generate GraphQL query with @live directive from the query function
  const { query, variables, cacheKey } = useMemo(() => {
    try {
      const graphqlQuery = buildQueryFromFunction(queryFn);
      // Ensure the query has @live directive for real-time updates
      const liveQuery = graphqlQuery.query.includes("@live")
        ? graphqlQuery.query
        : graphqlQuery.query.replace(/(\s*\{)/, " @live$1");

      const key = cache?.getKey(liveQuery, graphqlQuery.variables) || "";

      return {
        query: liveQuery,
        variables: graphqlQuery.variables,
        cacheKey: key,
      };
    } catch (error) {
      throw new Error(
        `Failed to build GraphQL query: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [queryFn, cache, ...(options.dependencies || [])]);

  // State management
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(!options.suspend);
  const [error, setError] = useState<LiveQueryError | undefined>(undefined);
  const [connectionState, setConnectionState] = useState(
    transport.getConnectionState(),
  );

  // Refs for cleanup and subscription management
  const subscriptionRef = useRef<LiveQuerySubscription<T> | null>(null);
  const mountedRef = useRef(true);
  const lastQueryRef = useRef<string>("");

  // Check cache first if enabled
  useEffect(() => {
    if (options.useCache !== false && cache && cacheKey) {
      const cachedData = cache.get<T>(cacheKey);
      if (cachedData) {
        setData(cachedData);
        setLoading(false);
      }
    }
  }, [cacheKey, cache, options.useCache]);

  // Handle connection state changes
  useEffect(() => {
    const unsubscribe = transport.onConnectionStateChange((state) => {
      if (!mountedRef.current) return;

      setConnectionState(state);
    });

    return unsubscribe;
  }, [transport]);

  // Create and manage subscription
  useEffect(() => {
    // Reset mounted flag - important for React Strict Mode
    mountedRef.current = true;

    if (options.suspend) {
      return undefined;
    }

    // Check if we need to create a new subscription
    const queryKey = `${query}:${JSON.stringify(variables)}`;
    const needsNewSubscription =
      queryKey !== lastQueryRef.current || !subscriptionRef.current;

    if (needsNewSubscription) {
      lastQueryRef.current = queryKey;

      // Clean up previous subscription
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }

      setLoading(true);
      setError(undefined);

      const subscription = transport.subscribe<T>(query, variables, options);
      subscriptionRef.current = subscription;
    }

    // Always register the callback, even if reusing subscription
    // This ensures the callback is registered after every render
    const subscription = subscriptionRef.current;
    if (!subscription) {
      return;
    }

    try {
      const unregisterUpdate = subscription.onUpdate((update) => {
        if (!mountedRef.current) {
          return;
        }

        // Update state with new data
        setData(subscription.data);
        setLoading(subscription.loading);
        setError(subscription.error);

        // Cache the updated result if caching is enabled
        if (
          options.useCache !== false &&
          cache &&
          cacheKey &&
          subscription.data
        ) {
          cache.set(cacheKey, subscription.data);
        }

        // Call custom update handler if provided
        if (options.onUpdate) {
          options.onUpdate(update);
        }

        // Call custom error handler if there's an error
        if (subscription.error && options.onError) {
          options.onError(subscription.error);
        }
      });

      return () => {
        mountedRef.current = false;
        unregisterUpdate();
        if (subscriptionRef.current) {
          subscriptionRef.current.unsubscribe();
          subscriptionRef.current = null;
        }
      };
    } catch (err) {
      const liveError: LiveQueryError = {
        code: "SUBSCRIPTION_FAILED",
        message: `Failed to create live query subscription: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date(),
        details: err,
      };

      setError(liveError);
      setLoading(false);

      if (options.onError) {
        options.onError(liveError);
      }
      return undefined;
    }
  }, [
    query,
    variables,
    options.suspend,
    transport,
    cache,
    cacheKey,
    options.useCache,
    options.onUpdate,
    options.onError,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  // Refetch function
  const refetch = useCallback(async () => {
    if (subscriptionRef.current) {
      setLoading(true);
      setError(undefined);
      try {
        await subscriptionRef.current.refetch();
      } catch (err) {
        const liveError: LiveQueryError = {
          code: "REFETCH_FAILED",
          message: `Failed to refetch query: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date(),
          details: err,
        };

        setError(liveError);
        setLoading(false);

        if (options.onError) {
          options.onError(liveError);
        }
      }
    }
  }, [options.onError]);

  const result: LiveQueryHookResult<T> = {
    data,
    loading,
    error,
    connectionState,
    refetch,
    subscription: subscriptionRef.current || undefined,
  };
  return result;
}

/**
 * Hook variant that suspends on loading (for use with React Suspense)
 */
export function useLiveQuerySuspense<T>(
  queryFn: QueryFunction<T>,
  options: Omit<UseLiveQueryOptions, "suspend"> = {},
): Omit<LiveQueryHookResult<T>, "loading"> {
  const result = useLiveQuery(queryFn, { ...options, suspend: false });

  if (result.loading && !result.data) {
    throw new Promise<void>((resolve) => {
      const checkData = () => {
        if (!result.loading || result.data !== undefined || result.error) {
          resolve();
        } else {
          setTimeout(checkData, 10);
        }
      };
      checkData();
    });
  }

  const suspenseResult: Omit<LiveQueryHookResult<T>, "loading"> = {
    data: result.data,
    error: result.error,
    connectionState: result.connectionState,
    refetch: result.refetch,
    subscription: result.subscription,
  };
  return suspenseResult;
}

/**
 * Hook to check if any live queries are currently loading
 */
export function useLiveQueryLoading(): boolean {
  // This could be enhanced to track all active subscriptions
  // For now, it's a placeholder for future implementation
  return false;
}

/**
 * Hook to get live query cache statistics
 */
export function useLiveQueryStats() {
  const { cache } = useLiveQueryContext();

  return useMemo(() => {
    if (!cache || !("getStats" in cache)) {
      return null;
    }

    return (cache as any).getStats();
  }, [cache]);
}

```


## Assistant

<thinking>
**Analyzing the Merge Strategy**

I'm currently focused on the merge strategy in `src/live/transport.ts`, specifically regarding `refetchOnReconnect`. I'm deciding whether to define a dedicated helper function, or simply handle the merging inline. Considering the complexity of `LiveQueryOptions`, the inline approach is feeling less attractive, but the scale of the changes is also very manageable.


**Addressing the Option Overrides**

I've decided to refine the merging logic in `src/live/transport.ts`. The initial spread approach would unintentionally overwrite properties with `undefined`. My solution involves iterating through the incoming `options` object and only assigning values if they are not `undefined`, ensuring more robust behavior. This is safer than the original approach.



</thinking>

I will modify `src/live/transport.ts` to implement a safer option merging strategy in the `subscribe` method. This ensures that properties with `undefined` values in the `options` argument do not overwrite the default values in `this.#options`.



**Tool Call: src/live/transport.ts:     query: string,... =>     query: string,...**
Status: Completed

Diff: transport.ts
```
/**
 * WebSocket-based transport layer for live queries
 * Implements the LiveQueryTransport interface using WebSocket connections
 */

import {
  LiveQueryTransport,
  LiveQuerySubscription,
  LiveQueryConnectionState,
  LiveQueryError,
  LiveQueryOptions,
  LiveQueryUpdate,
  LiveQueryUpdateType,
  ResolvedLiveQueryOptions,
} from "./types.js";

export class WebSocketLiveQueryTransport implements LiveQueryTransport {
  #websocket: WebSocket | null = null;
  #url: string;
  #options: ResolvedLiveQueryOptions;
  #connectionState: LiveQueryConnectionState = "disconnected";
  #subscriptions = new Map<string, InternalSubscription>();
  #connectionStateListeners = new Set<
    (state: LiveQueryConnectionState) => void
  >();
  #errorListeners = new Set<(error: LiveQueryError) => void>();
  #reconnectAttempts = 0;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #subscriptionCounter = 0;
  #messageQueue: any[] = [];

  // Test-only property for accessing WebSocket in tests
  public __testWebSocket?: WebSocket | null;

  constructor(url: string, options: LiveQueryOptions = {}) {
    this.#url = url;
    this.#options = {
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectDelay: options.reconnectDelay ?? 1000,
      exponentialBackoff: options.exponentialBackoff ?? true,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      headers: options.headers ?? {},
      authToken: options.authToken,
      websocketUrl: options.websocketUrl,
      debug: options.debug ?? false,
    };

    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Initialized with options:",
        this.#options,
      );
    }
  }

  async connect(): Promise<void> {
    if (
      this.#connectionState === "connected" ||
      this.#connectionState === "connecting"
    ) {
      return;
    }

    this.#setConnectionState("connecting");

    try {
      await this.#createWebSocketConnection();
    } catch (error) {
      this.#setConnectionState("error");
      const liveError: LiveQueryError = {
        code: "CONNECTION_FAILED",
        message: `Failed to connect to live query service: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
        details: error,
      };
      this.#emitError(liveError);
      throw liveError;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#reconnectTimeout) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = null;
    }

    if (this.#websocket) {
      this.#websocket.close();
      this.#websocket = null;
    }

    // Clear all subscriptions
    this.#subscriptions.clear();
    this.#messageQueue = [];

    this.#setConnectionState("closed");
  }

  subscribe<T>(
    query: string,
    variables?: Record<string, any>,
    options?: LiveQueryOptions,
  ): LiveQuerySubscription<T> {
    const subscriptionId = `sub_${++this.#subscriptionCounter}_${Date.now()}`;
    
    const mergedOptions = { ...this.#options };
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
          (mergedOptions as any)[key] = value;
        }
      }
    }

    const internalSub: InternalSubscription = {
      id: subscriptionId,
      query,
      variables: variables || {},
      options: mergedOptions,
      connectionState: this.#connectionState,
      data: undefined,
      error: undefined,
      loading: true,
      updateListeners: new Set(),
    };

    this.#subscriptions.set(subscriptionId, internalSub);

    // Send subscription message if connected
    if (this.#connectionState === "connected") {
      this.#sendSubscription(internalSub);
    } else {
      // Auto-connect if not already connecting
      if (this.#connectionState === "disconnected") {
        this.connect().catch((error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] Auto-connect failed:", error);
          }
        });
      }
    }

    return this.#createSubscriptionAPI(internalSub);
  }

  getConnectionState(): LiveQueryConnectionState {
    return this.#connectionState;
  }

  onConnectionStateChange(
    listener: (state: LiveQueryConnectionState) => void,
  ): () => void {
    this.#connectionStateListeners.add(listener);
    return () => this.#connectionStateListeners.delete(listener);
  }

  onError(listener: (error: LiveQueryError) => void): () => void {
    this.#errorListeners.add(listener);
    return () => this.#errorListeners.delete(listener);
  }

  #createWebSocketConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.#websocket = new WebSocket(this.#url, "graphql-transport-ws");
        this.__testWebSocket = this.#websocket; // For testing

        let isConnectionEstablished = false;

        this.#websocket.onopen = () => {
          if (this.#options.debug) {
            console.log("[LiveQueryTransport] WebSocket connected");
          }
          // Send connection_init message to establish protocol
          this.#websocket?.send(
            JSON.stringify({
              type: "connection_init",
              payload: this.#options.headers || {},
            }),
          );
        };

        this.#websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Handle connection acknowledgement
            if (message.type === "connection_ack") {
              this.#setConnectionState("connected");
              this.#reconnectAttempts = 0;
              this.#processMessageQueue();
              this.#resubscribeAll();
              isConnectionEstablished = true;
              resolve();
              return;
            }

            // Handle ping (respond with pong)
            if (message.type === "ping") {
              this.#websocket?.send(JSON.stringify({ type: "pong" }));
              return;
            }

            this.#handleMessage(message);
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to parse message:",
                error,
              );
            }
          }
        };

        this.#websocket.onclose = (event) => {
          if (this.#options.debug) {
            console.log(
              "[LiveQueryTransport] WebSocket closed:",
              event.code,
              event.reason,
            );
          }
          this.#websocket = null;
          this.__testWebSocket = null; // For testing

          if (!isConnectionEstablished) {
            reject(
              new Error(
                `WebSocket closed before connection established (Code: ${event.code})`,
              ),
            );
          }

          if (this.#connectionState !== "closed") {
            this.#setConnectionState("disconnected");
            this.#handleReconnection();
          }
        };

        this.#websocket.onerror = (error) => {
          if (this.#options.debug) {
            console.error("[LiveQueryTransport] WebSocket error:", error);
          }
          reject(new Error("WebSocket connection failed"));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  #setConnectionState(state: LiveQueryConnectionState): void {
    if (this.#connectionState !== state) {
      this.#connectionState = state;

      // Update all subscription states
      for (const subscription of this.#subscriptions.values()) {
        subscription.connectionState = state;
      }

      // Notify listeners
      for (const listener of this.#connectionStateListeners) {
        try {
          listener(state);
        } catch (error) {
          if (this.#options.debug) {
            console.error(
              "[LiveQueryTransport] Connection state listener error:",
              error,
            );
          }
        }
      }
    }
  }

  #emitError(error: LiveQueryError): void {
    for (const listener of this.#errorListeners) {
      try {
        listener(error);
      } catch (listenerError) {
        if (this.#options.debug) {
          console.error(
            "[LiveQueryTransport] Error listener failed:",
            listenerError,
          );
        }
      }
    }
  }

  #handleReconnection(): void {
    if (
      !this.#options.autoReconnect ||
      this.#reconnectAttempts >= this.#options.maxReconnectAttempts
    ) {
      this.#setConnectionState("error");
      const error: LiveQueryError = {
        code: "MAX_RECONNECT_ATTEMPTS",
        message: `Failed to reconnect after ${this.#reconnectAttempts} attempts`,
        timestamp: new Date(),
      };
      this.#emitError(error);
      return;
    }

    this.#setConnectionState("reconnecting");
    this.#reconnectAttempts++;

    let delay = this.#options.reconnectDelay;
    if (this.#options.exponentialBackoff) {
      delay = Math.min(
        delay * Math.pow(2, this.#reconnectAttempts - 1),
        this.#options.maxReconnectDelay,
      );
    }

    if (this.#options.debug) {
      console.log(
        `[LiveQueryTransport] Reconnecting in ${delay}ms (attempt ${this.#reconnectAttempts})`,
      );
    }

    this.#reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Reconnection failed:", error);
        }
      });
    }, delay);
  }

  #resubscribeAll(): void {
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Resubscribing all active subscriptions",
      );
    }
    for (const subscription of this.#subscriptions.values()) {
      if (subscription.options.refetchOnReconnect !== false) {
        this.#sendSubscription(subscription);
      }
    }
  }

  #processMessageQueue(): void {
    while (this.#messageQueue.length > 0) {
      const message = this.#messageQueue.shift();
      if (message?.type === "subscribe") {
        this.#sendSubscription(message.subscription);
      }
    }
  }

  #sendSubscription(subscription: InternalSubscription): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Sending query:", subscription.query);
    }
    if (!this.#websocket || this.#websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: "subscribe",
      id: subscription.id,
      payload: {
        query: subscription.query,
        variables: subscription.variables,
      },
    };

    try {
      this.#websocket.send(JSON.stringify(message));
      if (this.#options.debug) {
        console.log("[LiveQueryTransport] Sent subscription:", subscription.id);
      }
    } catch (error) {
      if (this.#options.debug) {
        console.error(
          "[LiveQueryTransport] Failed to send subscription:",
          error,
        );
      }
    }
  }

  #handleMessage(message: any): void {
    if (this.#options.debug) {
      console.log("[LiveQueryTransport] Received message:", message);
    }

    const { type, id, payload } = message;
    const subscription = this.#subscriptions.get(id);

    if (!subscription) {
      if (this.#options.debug) {
        console.warn(
          "[LiveQueryTransport] Received message for unknown subscription:",
          id,
        );
      }
      return;
    }

    switch (type) {
      case "next": // New protocol uses 'next'
      case "data": // Fallback
        this.#handleDataMessage(subscription, payload);
        break;
      case "error":
        this.#handleErrorMessage(subscription, payload);
        break;
      case "complete":
        this.#handleCompleteMessage(subscription);
        break;
      case "update":
        this.#handleUpdateMessage(subscription, payload);
        break;
      default:
        if (this.#options.debug) {
          console.warn("[LiveQueryTransport] Unknown message type:", type);
        }
    }
  }

  #handleDataMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Received data for subscription:",
        subscription.id,
        payload,
      );
    }
    subscription.loading = false;
    subscription.error = undefined;

    // Extract the actual query result from the GraphQL response
    // GraphQL responses are structured as { data: { fieldName: result } }
    // We need to extract the first field's value as that's the actual result
    let resultData = payload.data;
    if (
      resultData &&
      typeof resultData === "object" &&
      !Array.isArray(resultData)
    ) {
      const keys = Object.keys(resultData);
      if (keys.length === 1 && keys[0]) {
        resultData = resultData[keys[0]];
      }
    }

    subscription.data = resultData;

    // Notify update listeners
    // If it's a 'next' message, it might be a standard GraphQL result
    // We treat it as a refresh/update
    const update: LiveQueryUpdate = {
      type: "refresh",
      result: resultData,
      timestamp: new Date(),
      metadata: payload.extensions,
    };

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #handleErrorMessage(subscription: InternalSubscription, payload: any): void {
    if (this.#options.debug) {
      console.error(
        "[LiveQueryTransport] Subscription error payload:",
        payload,
      );
    }

    subscription.loading = false;
    subscription.error = {
      code: payload[0]?.extensions?.code || "QUERY_ERROR",
      message: payload[0]?.message || "Query execution failed",
      timestamp: new Date(),
      details: payload,
    };

    this.#notifySubscriptionUpdate(subscription, {
      type: "refresh",
      timestamp: new Date(),
    });
  }

  #handleCompleteMessage(subscription: InternalSubscription): void {
    subscription.loading = false;
    // Subscription completed - this is normal for live queries
    if (this.#options.debug) {
      console.log(
        "[LiveQueryTransport] Subscription completed:",
        subscription.id,
      );
    }
  }

  #handleUpdateMessage(subscription: InternalSubscription, payload: any): void {
    const updateType = payload.updateType as LiveQueryUpdateType;
    const update: LiveQueryUpdate = {
      type: updateType,
      data: payload.data,
      result: payload.result,
      timestamp: new Date(payload.timestamp),
      metadata: payload.metadata,
    };

    // Update local data based on update type
    if (
      updateType === "refresh" ||
      updateType === "insert" ||
      updateType === "update"
    ) {
      subscription.data = payload.result || payload.data;
    }

    this.#notifySubscriptionUpdate(subscription, update);
  }

  #notifySubscriptionUpdate(
    subscription: InternalSubscription,
    update: LiveQueryUpdate,
  ): void {
    for (const listener of subscription.updateListeners) {
      try {
        listener(update);
      } catch (error) {
        if (this.#options.debug) {
          console.error("[LiveQueryTransport] Update listener error:", error);
        }
      }
    }
  }

  #createSubscriptionAPI<T>(
    internal: InternalSubscription,
  ): LiveQuerySubscription<T> {
    return {
      id: internal.id,
      query: internal.query,
      variables: internal.variables,
      get connectionState(): LiveQueryConnectionState {
        return internal.connectionState;
      },
      get data(): T | undefined {
        return internal.data as T | undefined;
      },
      get error(): LiveQueryError | undefined {
        return internal.error;
      },
      get loading(): boolean {
        return internal.loading;
      },
      unsubscribe: () => {
        this.#subscriptions.delete(internal.id);

        if (this.#websocket && this.#websocket.readyState === WebSocket.OPEN) {
          try {
            this.#websocket.send(
              JSON.stringify({
                type: "complete", // Protocol uses 'complete' to stop subscription
                id: internal.id,
              }),
            );
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] Failed to send unsubscribe:",
                error,
              );
            }
          }
        }
      },
      refetch: async () => {
        if (this.#connectionState === "connected") {
          internal.loading = true;
          this.#sendSubscription(internal);
        } else {
          throw new Error("Cannot refetch: not connected");
        }
      },
      onUpdate: (callback: (update: LiveQueryUpdate) => void) => {
        internal.updateListeners.add(callback);

        // Immediately invoke callback if data is already available (handles race conditions)
        if (internal.data !== undefined) {
          try {
            callback({
              type: "refresh",
              result: internal.data,
              timestamp: new Date(),
            });
          } catch (error) {
            if (this.#options.debug) {
              console.error(
                "[LiveQueryTransport] onUpdate callback error:",
                error,
              );
            }
          }
        }

        return () => {
          internal.updateListeners.delete(callback);
        };
      },
    };
  }
}

// Internal subscription representation
interface InternalSubscription {
  id: string;
  query: string;
  variables: Record<string, any>;
  options: ResolvedLiveQueryOptions;
  connectionState: LiveQueryConnectionState;
  data: any;
  error: LiveQueryError | undefined;
  loading: boolean;
  updateListeners: Set<(update: LiveQueryUpdate) => void>;
}

// Export default transport instance
export const defaultLiveQueryTransport = (
  url: string,
  options?: LiveQueryOptions,
) => new WebSocketLiveQueryTransport(url, options);

// Test accessor for private WebSocket field (only for testing)
declare global {
  interface Window {
    __TEST_MODE__?: boolean;
  }
}

```


## Assistant

<thinking>
**Implementing Resubscription Logic**

I've made the necessary code changes and completed the execution phase. I refactored the resubscription logic to reside within the transport layer. This eliminates the double-subscription problem, resolving the "Subscriber already exists" issue. I've also removed the redundant resubscription code from `useLiveQuery`.



</thinking>

I will run the tests associated with the live query functionality, specifically `__tests__/live/transport.test.ts`, `__tests__/live/live-queries.test.ts`, and `__tests__/react/use

<thinking>
**Validating Test Coverage**

Okay, the refactoring's wrapped up. Next step: confirm all tests pass. I'm focusing on the `live` query tests. I've pinpointed the relevant tests to execute: `transport.test.ts`, `live-queries.test.ts`, and `useLiveQuery.test.tsx`. I'll run these using `npx vitest` to check for any regressions. Hopefully, everything's still green.



</thinking>

LiveQuery.test.tsx`, to ensure that my changes haven't introduced any regressions and that the new logic works as expected.



**Tool Call: npx vitest run __tests__/live/transport.test.ts __tests__/live/live-queries.test.ts __tests__/react/useLiveQuery.test.tsx [current working directory /Users/tobbe/tmp/gqlorm]**
Status: Completed


 RUN  v4.0.17 /Users/tobbe/tmp/gqlorm

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should initialize with disconnected state
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should connect successfully
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should connect successfully
[LiveQueryTransport] WebSocket connected

 ❯  node  __tests__/live/live-queries.test.ts (28 tests | 2 failed) 8ms
       ✓ should generate regular queries without @live directive by default 1ms
       ✓ should generate live queries with @live directive when explicitly requested 0ms
       ✓ should use buildLiveQuery convenience function 0ms
       ✓ should generate live queries from query functions 0ms
       ✓ should generate live queries for all operations 0ms
       ✓ should place @live directive in correct position 0ms
       ✓ should work with complex nested queries 0ms
       ✓ should respect enableLiveQueries option 0ms
       × should respect forceLiveQueries option 3ms
       ✓ should allow explicit override when enableLiveQueries is true 0ms
       × should not override forceLiveQueries with explicit false 0ms
       ✓ should create live query from regular query 0ms
       ✓ should not duplicate @live directive 0ms
       ✓ should create regular query when isLive is false 0ms
       ✓ should detect live queries correctly 0ms
       ✓ should remove live directive 0ms
       ✓ should handle multiple @live directives 0ms
       ✓ should capture and convert simple queries 0ms
       ✓ should capture complex nested queries 0ms
       ✓ should handle different query operations in live mode 0ms
       ✓ should preserve query variables in live queries 0ms
       ✓ should handle invalid query functions gracefully 0ms
       ✓ should handle malformed queries in createLiveQuery 0ms
       ✓ should maintain variable references in live queries 0ms
       ✓ should handle empty variables in live queries 0ms
       ✓ should maintain proper GraphQL query structure with @live 0ms
       ✓ should handle queries with no arguments 0ms
       ✓ should format complex nested structures properly 0ms
stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should connect successfully
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should handle connection errors
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stderr | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should handle connection errors
[LiveQueryTransport] WebSocket error: Event {
  type: 'error',
  defaultPrevented: false,
  cancelable: false,
  timeStamp: 5125.090292
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should handle connection errors
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should disconnect properly
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should disconnect properly
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should disconnect properly
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should disconnect properly
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should disconnect properly
[LiveQueryTransport] WebSocket connected

 ❯  react  __tests__/react/useLiveQuery.test.tsx (25 tests | 16 failed) 7114ms
       × should initialize with loading state 15ms
       ✓ should create subscription when mounted 2ms
       × should handle successful data updates 1005ms
       × should handle errors gracefully 1005ms
       ✓ should handle findUnique queries 3ms
       ✓ should handle findFirst queries 2ms
       × should handle complex queries with relations 5ms
       × should respect suspend option 3ms
       × should use cache when enabled 1003ms
       × should call custom error handler 1006ms
       ✓ should call custom update handler 3ms
       × should update connection state when transport changes 3ms
       × should refetch on reconnect when enabled 1005ms
       ✓ should refetch when dependencies change 8ms
       ✓ should unsubscribe when component unmounts 3ms
       ✓ should handle cleanup properly 2ms
       ✓ should handle invalid query functions 3ms
       × should handle transport subscription failures 1ms
       × should handle missing transport gracefully 16ms
       × should suspend when loading and no data 3ms
       × should resolve suspense when data is available 1ms
       × should handle live data updates 1005ms
       × should cache updated data when caching is enabled 1006ms
       × should provide refetch function 3ms
       ✓ should call subscription refetch when refetch is called 3ms
stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should disconnect properly
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should create subscriptions
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should create subscriptions
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should create subscriptions
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should create subscriptions
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription data updates
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription data updates
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription data updates
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription data updates
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription errors
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription errors
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription errors
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription errors
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle live updates
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle live updates
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle live updates
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle live updates
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should unsubscribe properly
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should unsubscribe properly
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should unsubscribe properly
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should unsubscribe properly
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should refetch subscriptions
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should refetch subscriptions
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should refetch subscriptions
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should refetch subscriptions
[LiveQueryTransport] WebSocket closed: 0 
[LiveQueryTransport] Reconnecting in 1000ms (attempt 1)

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Reconnection Logic > should attempt reconnection on disconnect
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Reconnection Logic > should attempt reconnection on disconnect
[LiveQueryTransport] WebSocket connected

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Reconnection Logic > should stop reconnecting after max attempts
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Options and Configuration > should use custom options
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Options and Configuration > should handle queued subscriptions when disconnected
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle JSON parse errors in messages
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stderr | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle JSON parse errors in messages
[LiveQueryTransport] WebSocket error: Event {
  type: 'error',
  defaultPrevented: false,
  cancelable: false,
  timeStamp: 75258.046167
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle unknown message types
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stderr | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle unknown message types
[LiveQueryTransport] WebSocket error: Event {
  type: 'error',
  defaultPrevented: false,
  cancelable: false,
  timeStamp: 75266.724875
}

stdout | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle messages for unknown subscriptions
[LiveQueryTransport] Initialized with options: {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  exponentialBackoff: true,
  maxReconnectDelay: 30000,
  headers: {},
  authToken: undefined,
  websocketUrl: undefined,
  debug: true
}

stderr | __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle messages for unknown subscriptions
[LiveQueryTransport] WebSocket error: Event {
  type: 'error',
  defaultPrevented: false,
  cancelable: false,
  timeStamp: 75272.941083
}

 ❯  node  __tests__/live/transport.test.ts (17 tests | 14 failed) 75175ms
       ✓ should initialize with disconnected state 1ms
       × should connect successfully 5020ms
       ✓ should handle connection errors 6ms
       × should disconnect properly 5003ms
       × should create subscriptions 10002ms
       × should handle subscription data updates 10002ms
       × should handle subscription errors 10002ms
       × should handle live updates 10002ms
       × should unsubscribe properly 10001ms
       × should refetch subscriptions 10002ms
       × should attempt reconnection on disconnect 5002ms
       × should stop reconnecting after max attempts 109ms
       ✓ should use custom options 0ms
       × should handle queued subscriptions when disconnected 3ms
       × should handle JSON parse errors in messages 8ms
       × should handle unknown message types 6ms
       × should handle messages for unknown subscriptions 6ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 32 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL   node  __tests__/live/live-queries.test.ts > @live Directive Query Generation > Query Builder Configuration > should respect forceLiveQueries option
AssertionError: expected 'query findManyUser($var0: Boolean) {\…' to contain '@live'

- Expected
+ Received

- @live
+ query findManyUser($var0: Boolean) {
+   users(where: { isActive: $var0 }) {
+     id
+     createdAt
+     updatedAt
+   }
+ }

 ❯ __tests__/live/live-queries.test.ts:138:28
    136|       ); // Explicit false should be overridden
    137| 
    138|       expect(result.query).toContain("@live");
       |                            ^
    139|     });
    140| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/32]⎯

 FAIL   node  __tests__/live/live-queries.test.ts > @live Directive Query Generation > Query Builder Configuration > should not override forceLiveQueries with explicit false
AssertionError: expected 'query findManyUser($var0: Boolean) {\…' to contain '@live'

- Expected
+ Received

- @live
+ query findManyUser($var0: Boolean) {
+   users(where: { isActive: $var0 }) {
+     id
+     createdAt
+     updatedAt
+   }
+ }

 ❯ __tests__/live/live-queries.test.ts:169:28
    167| 
    168|       // forceLiveQueries should take precedence
    169|       expect(result.query).toContain("@live");
       |                            ^
    170|     });
    171|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should connect successfully
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ __tests__/live/transport.test.ts:125:5
    123|     });
    124| 
    125|     it("should connect successfully", async () => {
       |     ^
    126|       const stateChanges: LiveQueryConnectionState[] = [];
    127|       transport.onConnectionStateChange((state) => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Connection Management > should disconnect properly
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ __tests__/live/transport.test.ts:161:5
    159|     });
    160| 
    161|     it("should disconnect properly", async () => {
       |     ^
    162|       await transport.connect();
    163|       expect(transport.getConnectionState()).toBe("connected");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should create subscriptions
 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription data updates
 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle subscription errors
 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should handle live updates
 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should unsubscribe properly
 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Subscription Management > should refetch subscriptions
Error: Hook timed out in 10000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
 ❯ __tests__/live/transport.test.ts:171:5
    169| 
    170|   describe("Subscription Management", () => {
    171|     beforeEach(async () => {
       |     ^
    172|       await transport.connect();
    173|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Reconnection Logic > should attempt reconnection on disconnect
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ __tests__/live/transport.test.ts:312:5
    310| 
    311|   describe("Reconnection Logic", () => {
    312|     it("should attempt reconnection on disconnect", async () => {
       |     ^
    313|       const transport = new WebSocketLiveQueryTransport(testUrl, {
    314|         autoReconnect: true,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Reconnection Logic > should stop reconnecting after max attempts
AssertionError: expected undefined to be defined
 ❯ __tests__/live/transport.test.ts:377:31
    375|         (e) => e.code === "MAX_RECONNECT_ATTEMPTS",
    376|       );
    377|       expect(maxAttemptError).toBeDefined();
       |                               ^
    378|     });
    379|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Options and Configuration > should handle queued subscriptions when disconnected
AssertionError: expected 'connecting' to be 'disconnected' // Object.is equality

Expected: "disconnected"
Received: "connecting"

 ❯ __tests__/live/transport.test.ts:401:44
    399|       const subscription = transport.subscribe(query);
    400| 
    401|       expect(subscription.connectionState).toBe("disconnected");
       |                                            ^
    402|       expect(subscription.loading).toBe(true);
    403| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle JSON parse errors in messages
Unknown Error: Failed to connect to live query service: WebSocket connection failed
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle unknown message types
Unknown Error: Failed to connect to live query service: WebSocket connection failed
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/32]⎯

 FAIL   node  __tests__/live/transport.test.ts > WebSocketLiveQueryTransport > Error Handling > should handle messages for unknown subscriptions
Unknown Error: Failed to connect to live query service: WebSocket connection failed
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Basic Hook Functionality > should initialize with loading state
Error: Invalid Chai property: toHaveTextContent
 ❯ __tests__/react/useLiveQuery.test.tsx:176:44
    174|       renderWithProvider(<TestComponent queryFn={queryFn} />);
    175| 
    176|       expect(screen.getByTestId('loading')).toHaveTextContent('true');
       |                                            ^
    177|       expect(screen.getByTestId('has-data')).toHaveTextContent('false'…
    178|       expect(screen.getByTestId('has-error')).toHaveTextContent('false…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[12/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Basic Hook Functionality > should handle successful data updates
TestingLibraryElementError: Found multiple elements by: [data-testid="loading"]

Here are the matching elements:

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
<body>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
</body>

Ignored nodes: comments, script, style
<html>
  <head />
  <body>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
  </body>
</html>
 ❯ waitForWrapper node_modules/@testing-library/dom/dist/wait-for.js:163:27
 ❯ __tests__/react/useLiveQuery.test.tsx:209:13
    207|       });
    208| 
    209|       await waitFor(() => {
       |             ^
    210|         expect(screen.getByTestId('loading')).toHaveTextContent('false…
    211|         expect(screen.getByTestId('has-data')).toHaveTextContent('true…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[13/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Basic Hook Functionality > should handle errors gracefully
TestingLibraryElementError: Found multiple elements by: [data-testid="loading"]

Here are the matching elements:

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
<body>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
</body>

Ignored nodes: comments, script, style
<html>
  <head />
  <body>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
  </body>
</html>
 ❯ waitForWrapper node_modules/@testing-library/dom/dist/wait-for.js:163:27
 ❯ __tests__/react/useLiveQuery.test.tsx:235:13
    233|       });
    234| 
    235|       await waitFor(() => {
       |             ^
    236|         expect(screen.getByTestId('loading')).toHaveTextContent('false…
    237|         expect(screen.getByTestId('has-error')).toHaveTextContent('tru…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[14/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Query Function Variations > should handle complex queries with relations
AssertionError: expected 'query findManyUser($var0: Boolean, $v…' to contain 'posts {'

- Expected
+ Received

- posts {
+ query findManyUser($var0: Boolean, $var1: Boolean, $var2: Boolean) @live {
+   users(where: { AND: [{ isActive: $var0 }, { posts: { some: { published: $var1 } } }] }) {
+     id
+     posts(where: { published: $var2 }, first: 5) {
+           id
+     }
+     profile {
+           id
+     }
+   }
+ }

 ❯ __tests__/react/useLiveQuery.test.tsx:297:32
    295|       const subscribeCall = mockTransport.subscribe.mock.calls[0];
    296|       expect(subscribeCall[0]).toContain('@live');
    297|       expect(subscribeCall[0]).toContain('posts {');
       |                                ^
    298|       expect(subscribeCall[0]).toContain('profile {');
    299|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[15/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Hook Options > should respect suspend option
TestingLibraryElementError: Found multiple elements by: [data-testid="loading"]

Here are the matching elements:

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

Ignored nodes: comments, script, style
<div
  data-testid="loading"
>
  false
</div>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
<body>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        false
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        null
      </div>
    </div>
  </div>
</body>
 ❯ Object.getElementError node_modules/@testing-library/dom/dist/config.js:37:19
 ❯ getElementError node_modules/@testing-library/dom/dist/query-helpers.js:20:35
 ❯ getMultipleElementsFoundError node_modules/@testing-library/dom/dist/query-helpers.js:23:10
 ❯ node_modules/@testing-library/dom/dist/query-helpers.js:55:13
 ❯ node_modules/@testing-library/dom/dist/query-helpers.js:95:19
 ❯ __tests__/react/useLiveQuery.test.tsx:311:21
    309|       // Should not create subscription when suspended
    310|       expect(mockTransport.subscribe).not.toHaveBeenCalled();
    311|       expect(screen.getByTestId('loading')).toHaveTextContent('false');
       |                     ^
    312|     });
    313| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[16/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Hook Options > should use cache when enabled
TestingLibraryElementError: Found multiple elements by: [data-testid="data"]

Here are the matching elements:

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  {"users":[{"id":"1","name":"Cached User"}]}
</div>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
<body>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        false
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        null
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        true
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        {"users":[{"id":"1","name":"Cached User"}]}
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
</body>

Ignored nodes: comments, script, style
<html>
  <head />
  <body>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          false
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          null
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          true
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          {"users":[{"id":"1","name":"Cached User"}]}
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
  </body>
</html>
 ❯ waitForWrapper node_modules/@testing-library/dom/dist/wait-for.js:163:27
 ❯ __tests__/react/useLiveQuery.test.tsx:323:13
    321|       renderWithProvider(<TestComponent queryFn={queryFn} options={{ u…
    322| 
    323|       await waitFor(() => {
       |             ^
    324|         expect(mockCache.get).toHaveBeenCalled();
    325|         expect(screen.getByTestId('data')).toHaveTextContent(JSON.stri…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[17/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Hook Options > should call custom error handler
AssertionError: expected "vi.fn()" to be called with arguments: [ { code: 'TEST_ERROR', …(2) } ]

Received: 

  1st vi.fn() call:

  [
    {
-     "code": "TEST_ERROR",
-     "message": "Custom error",
-     "timestamp": 2026-01-20T06:43:16.733Z,
+     "code": "SUBSCRIPTION_FAILED",
+     "details": TypeError {
+       "message": "subscription.onUpdate is not a function",
+     },
+     "message": "Failed to create live query subscription: subscription.onUpdate is not a function",
+     "timestamp": 2026-01-20T06:43:16.735Z,
    },
  ]


Number of calls: 1


Ignored nodes: comments, script, style
<html>
  <head />
  <body>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          false
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          null
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          true
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          {"users":[{"id":"1","name":"Cached User"}]}
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
  </body>
</html>
 ❯ __tests__/react/useLiveQuery.test.tsx:352:25
    350| 
    351|       await waitFor(() => {
    352|         expect(onError).toHaveBeenCalledWith(testError);
       |                         ^
    353|       });
    354|     });
 ❯ runWithExpensiveErrorDiagnosticsDisabled node_modules/@testing-library/dom/dist/config.js:47:12
 ❯ checkCallback node_modules/@testing-library/dom/dist/wait-for.js:124:77
 ❯ Timeout.checkRealTimersCallback node_modules/@testing-library/dom/dist/wait-for.js:118:16

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[18/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Connection State Changes > should update connection state when transport changes
TestingLibraryElementError: Found multiple elements by: [data-testid="connection-state"]

Here are the matching elements:

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

Ignored nodes: comments, script, style
<div
  data-testid="connection-state"
>
  disconnected
</div>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
<body>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        false
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        null
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        true
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        {"users":[{"id":"1","name":"Cached User"}]}
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
</body>
 ❯ Object.getElementError node_modules/@testing-library/dom/dist/config.js:37:19
 ❯ getElementError node_modules/@testing-library/dom/dist/query-helpers.js:20:35
 ❯ getMultipleElementsFoundError node_modules/@testing-library/dom/dist/query-helpers.js:23:10
 ❯ node_modules/@testing-library/dom/dist/query-helpers.js:55:13
 ❯ node_modules/@testing-library/dom/dist/query-helpers.js:95:19
 ❯ __tests__/react/useLiveQuery.test.tsx:383:21
    381|       renderWithProvider(<TestComponent queryFn={queryFn} />);
    382| 
    383|       expect(screen.getByTestId('connection-state')).toHaveTextContent…
       |                     ^
    384| 
    385|       // Simulate connection state change

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[19/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Connection State Changes > should refetch on reconnect when enabled
AssertionError: expected "vi.fn()" to be called at least once

Ignored nodes: comments, script, style
<html>
  <head />
  <body>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          false
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          null
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          true
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          {"users":[{"id":"1","name":"Cached User"}]}
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          connected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
  </body>
</html>
 ❯ __tests__/react/useLiveQuery.test.tsx:413:38
    411| 
    412|       await waitFor(() => {
    413|         expect(subscription.refetch).toHaveBeenCalled();
       |                                      ^
    414|       });
    415|     });
 ❯ runWithExpensiveErrorDiagnosticsDisabled node_modules/@testing-library/dom/dist/config.js:47:12
 ❯ checkCallback node_modules/@testing-library/dom/dist/wait-for.js:124:77
 ❯ Timeout.checkRealTimersCallback node_modules/@testing-library/dom/dist/wait-for.js:118:16

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[20/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Error Cases > should handle transport subscription failures
Error: Subscription failed
 ❯ Object.<anonymous> __tests__/react/useLiveQuery.test.tsx:505:15
    503|     it('should handle transport subscription failures', async () => {
    504|       mockTransport.subscribe.mockImplementation(() => {
    505|         throw new Error('Subscription failed');
       |               ^
    506|       });
    507| 
 ❯ src/react/useLiveQuery.ts:152:38
 ❯ Object.react_stack_bottom_frame node_modules/react-dom/cjs/react-dom-client.development.js:25989:20
 ❯ runWithFiberInDEV node_modules/react-dom/cjs/react-dom-client.development.js:874:13
 ❯ commitHookEffectListMount node_modules/react-dom/cjs/react-dom-client.development.js:13249:29
 ❯ commitHookPassiveMountEffects node_modules/react-dom/cjs/react-dom-client.development.js:13336:11
 ❯ commitPassiveMountOnFiber node_modules/react-dom/cjs/react-dom-client.development.js:15484:13
 ❯ recursivelyTraversePassiveMountEffects node_modules/react-dom/cjs/react-dom-client.development.js:15439:11
 ❯ commitPassiveMountOnFiber node_modules/react-dom/cjs/react-dom-client.development.js:15718:11

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[21/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Error Cases > should handle missing transport gracefully
AssertionError: expected [Function] to throw an error

- Expected: 
null

+ Received: 
undefined

 ❯ __tests__/react/useLiveQuery.test.tsx:533:10
    531|           </LiveQueryProvider>
    532|         );
    533|       }).toThrow('useLiveQuery requires a transport instance');
       |          ^
    534|     });
    535|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[22/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > useLiveQuerySuspense > should suspend when loading and no data
Error: Invalid Chai property: toBeInTheDocument
 ❯ __tests__/react/useLiveQuery.test.tsx:564:53
    562| 
    563|       // Should show suspense fallback initially
    564|       expect(screen.getByTestId('suspense-loading')).toBeInTheDocument…
       |                                                     ^
    565|       expect(suspended).toBe(true);
    566|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[23/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > useLiveQuerySuspense > should resolve suspense when data is available
TypeError: Cannot read properties of undefined (reading 'id')
 ❯ __tests__/react/useLiveQuery.test.tsx:592:56
    590|         const subscriptions = mockTransport._getSubscriptions();
    591|         const subscription = Array.from(subscriptions.values())[0];
    592|         mockTransport._updateSubscription(subscription.id, testData, f…
       |                                                        ^
    593|       });
    594| 
 ❯ node_modules/@testing-library/react/dist/act-compat.js:48:24
 ❯ process.env.NODE_ENV.exports.act node_modules/react/cjs/react.development.js:814:22
 ❯ node_modules/@testing-library/react/dist/act-compat.js:47:25
 ❯ __tests__/react/useLiveQuery.test.tsx:589:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[24/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Real-time Updates > should handle live data updates
TestingLibraryElementError: Found multiple elements by: [data-testid="data"]

Here are the matching elements:

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  {"users":[{"id":"1","name":"Cached User"}]}
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

Ignored nodes: comments, script, style
<div
  data-testid="data"
>
  null
</div>

(If this is intentional, then use the `*AllBy*` variant of the query (like `queryAllByText`, `getAllByText`, or `findAllByText`)).

Ignored nodes: comments, script, style
<body>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        false
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        null
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        true
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        {"users":[{"id":"1","name":"Cached User"}]}
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        connected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="user-id"
      >
        2
      </div>
      <button
        data-testid="change-user"
      >
        Change User
      </button>
      <div
        data-testid="loading"
      >
        false
      </div>
    </div>
  </div>
  <div />
  <div />
  <div />
  <div />
  <div>
    <div>
      <div
        data-testid="loading"
      >
        true
      </div>
      <div
        data-testid="connection-state"
      >
        error
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        false
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        null
      </div>
    </div>
  </div>
  <div>
    <div
      data-testid="suspense-loading"
    >
      Loading...
    </div>
  </div>
  <div>
    <div
      data-testid="suspense-loading"
    >
      Loading...
    </div>
  </div>
  <div>
    <div>
      <div
        data-testid="loading"
      >
        false
      </div>
      <div
        data-testid="connection-state"
      >
        disconnected
      </div>
      <div
        data-testid="has-data"
      >
        false
      </div>
      <div
        data-testid="has-error"
      >
        true
      </div>
      <div
        data-testid="data"
      >
        null
      </div>
      <div
        data-testid="error"
      >
        Failed to create live query subscription: subscription.onUpdate is not a function
      </div>
    </div>
  </div>
</body>

Ignored nodes: comments, script, style
<html>
  <head />
  <body>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          false
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          null
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          true
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          {"users":[{"id":"1","name":"Cached User"}]}
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          connected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="user-id"
        >
          2
        </div>
        <button
          data-testid="change-user"
        >
          Change User
        </button>
        <div
          data-testid="loading"
        >
          false
        </div>
      </div>
    </div>
    <div />
    <div />
    <div />
    <div />
    <div>
      <div>
        <div
          data-testid="loading"
        >
          true
        </div>
        <div
          data-testid="connection-state"
        >
          error
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          false
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          null
        </div>
      </div>
    </div>
    <div>
      <div
        data-testid="suspense-loading"
      >
        Loading...
      </div>
    </div>
    <div>
      <div
        data-testid="suspense-loading"
      >
        Loading...
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
  </body>
</html>
 ❯ waitForWrapper node_modules/@testing-library/dom/dist/wait-for.js:163:27
 ❯ __tests__/react/useLiveQuery.test.tsx:619:13
    617|       });
    618| 
    619|       await waitFor(() => {
       |             ^
    620|         expect(screen.getByTestId('data')).toHaveTextContent(JSON.stri…
    621|       });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[25/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Real-time Updates > should cache updated data when caching is enabled
AssertionError: expected "vi.fn()" to be called with arguments: [ Any<String>, …(1) ]

Number of calls: 0


Ignored nodes: comments, script, style
<html>
  <head />
  <body>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          false
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          null
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          true
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          {"users":[{"id":"1","name":"Cached User"}]}
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          connected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="user-id"
        >
          2
        </div>
        <button
          data-testid="change-user"
        >
          Change User
        </button>
        <div
          data-testid="loading"
        >
          false
        </div>
      </div>
    </div>
    <div />
    <div />
    <div />
    <div />
    <div>
      <div>
        <div
          data-testid="loading"
        >
          true
        </div>
        <div
          data-testid="connection-state"
        >
          error
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          false
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          null
        </div>
      </div>
    </div>
    <div>
      <div
        data-testid="suspense-loading"
      >
        Loading...
      </div>
    </div>
    <div>
      <div
        data-testid="suspense-loading"
      >
        Loading...
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
    <div>
      <div>
        <div
          data-testid="loading"
        >
          false
        </div>
        <div
          data-testid="connection-state"
        >
          disconnected
        </div>
        <div
          data-testid="has-data"
        >
          false
        </div>
        <div
          data-testid="has-error"
        >
          true
        </div>
        <div
          data-testid="data"
        >
          null
        </div>
        <div
          data-testid="error"
        >
          Failed to create live query subscription: subscription.onUpdate is not a function
        </div>
      </div>
    </div>
  </body>
</html>
 ❯ __tests__/react/useLiveQuery.test.tsx:650:31
    648| 
    649|       await waitFor(() => {
    650|         expect(mockCache.set).toHaveBeenCalledWith(
       |                               ^
    651|           expect.any(String),
    652|           testData
 ❯ runWithExpensiveErrorDiagnosticsDisabled node_modules/@testing-library/dom/dist/config.js:47:12
 ❯ checkCallback node_modules/@testing-library/dom/dist/wait-for.js:124:77
 ❯ Timeout.checkRealTimersCallback node_modules/@testing-library/dom/dist/wait-for.js:118:16

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[26/32]⎯

 FAIL   react  __tests__/react/useLiveQuery.test.tsx > useLiveQuery > Refetch Functionality > should provide refetch function
Error: Invalid Chai property: toHaveTextContent
 ❯ __tests__/react/useLiveQuery.test.tsx:678:48
    676|       renderWithProvider(<TestRefetchComponent />);
    677| 
    678|       expect(screen.getByTestId('has-refetch')).toHaveTextContent('tru…
       |                                                ^
    679|       expect(refetchFn).toBeDefined();
    680|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[27/32]⎯


 Test Files  3 failed (3)
      Tests  32 failed | 38 passed (70)
   Start at  07:43:13
   Duration  75.30s (transform 113ms, setup 0ms, import 218ms, tests 82.30s, environment 331ms)

## Assistant

<thinking>
**Diagnosing Test Failures**

I'm now zeroing in on the failed tests. The `transport.test.ts` timeouts are particularly concerning. It seems my alterations to `transport.ts` might have disrupted the mock socket handling or event loop management within the tests. The failures in `useLiveQuery.test.tsx` also demand immediate attention, as they point toward potential logic errors.


**Investigating Subscription Issues**

The core issue appears to be the missing `onUpdate` function on the subscription object, stemming from failures in `useLiveQuery.test.tsx`.  This suggests a mismatch between the mocked `mockTransport` and the changes I implemented in `transport.ts`. The error in `useLiveQuery.test.tsx` seems to be the most immediate concern.


**Isolating the Root Cause**

I'm now zeroing in on the root cause: a missing `onUpdate` function on the subscription object within `useLiveQuery.test.tsx`. After reviewing the mocks, I believe the mock transport isn't providing the `onUpdate` method expected by the `useLiveQuery` component. This discrepancy, coupled with the timeouts in `transport.test.ts`, strongly suggests a mismatch between my transport changes and the test environment's expectations. I will now examine the `mockTransport` implementation.


**Addressing Mock Implementations**

I'm now shifting my focus to `__tests__/react/useLiveQuery.test.tsx` to understand the `mockTransport` implementation. I anticipate the core problem lies in this mock failing to provide the `onUpdate` function expected by the `useLiveQuery` component. Since I modified `transport.ts` and the tests likely rely on an outdated mock, the mismatch in behavior explains the observed errors. This should also help me fix the issue preventing subscriptions from being created.



</thinking>

I will read `__tests__/react/useLiveQuery.test.tsx` to investigate the "subscription.onUpdate is not a function" error and understand how the transport mock is implemented. I will also read `__tests__/live/transport.test.ts` to understand why the tests are timing out and how the message queue is being tested.



**Tool Call: __tests__/.../useLiveQuery.test.tsx**
Status: Completed

**Tool Call: __tests__/live/transport.test.ts**
Status: Completed

## Assistant

<thinking>
**Pinpointing the Failures**

I've located the root cause of the test failures. Specifically, the mocked transport layer in `useLiveQuery.test.tsx` is the culprit. It omitted the crucial `onUpdate` method, which `useLiveQuery` now relies on.


**Debugging the Mock Transport**

My focus is now on the test failures, specifically in `useLiveQuery.test.tsx`. I've confirmed the mock transport's subscription object is missing the critical `onUpdate` method, which is now mandatory due to changes in `useLiveQuery.ts`. I'm updating the test to include this method in the mock implementation to address the failures there.


**Diagnosing Test Troubles**

I'm now fully immersed in the test failures. I've pinpointed the `onUpdate` omission in the `useLiveQuery.test.tsx` mock as a major issue, and plan to implement it to fix the tests there. Additionally, I am analyzing `transport.test.ts`. I've confirmed that the "queued subscriptions" test fails due to the immediate connection attempt in `subscribe`, and I'm updating the test to reflect the `connecting` state. The timeout issues will require further examination, potentially related to changes in the WebSocket mocking or the altered event sequences.


**Resolving the Test Issues**

I've examined the failing tests thoroughly. The `useLiveQuery.test.tsx` failure is due to the absent `onUpdate` method in the mock transport's subscription object, something I'll address immediately. For `transport.test.ts`, I've realized the "queued subscriptions" test fails because the connection state is now "connecting," not "disconnected," due to my changes triggering an immediate connect. Also, the timeout in "should connect successfully" likely stems from `MockWebSocket` failing to send the required `connection_ack` after receiving `connection_init`.


**Addressing the Failures**

I'm now diagnosing the failing tests comprehensively. The `useLiveQuery.test.tsx` failure stems from the missing `onUpdate` method in the mock transport's subscription object; I plan to correct this immediately. Regarding `transport.test.ts`, the "queued subscriptions" test fails because my changes trigger an immediate connection, making the expected state "connecting," not "disconnected." Additionally, the timeout in the "should connect successfully" test is likely due to the `MockWebSocket`'s failure to send the necessary `connection_ack` message after receiving `connection_init`.


**Identifying Test Issues**

I've now analyzed the failing tests in detail. In `useLiveQuery.test.tsx`, the mock transport is missing the essential `onUpdate` method within the subscription object. In `transport.test.ts`, the "queued subscriptions" test fails because my changes cause the connection state to immediately transition to "connecting." Furthermore, the "should connect successfully" timeout likely stems from the `MockWebSocket`'s failure to send a `connection_ack` message upon receiving `connection_init`.


**Addressing Test Failures**

I'm now fully immersed in fixing the tests. First, I will update `useLiveQuery.test.tsx` by adding the missing `onUpdate` method to the mock subscription object. After that, I will modify `transport.test.ts`, changing the expected state in the "queued subscriptions" test to "connecting," and updating `MockWebSocket` to respond to `connection_init` with `connection_ack`.



</thinking>

I will modify `__tests__/react/useLiveQuery.test.tsx` to include the `onUpdate` method in the mock subscription object within the `createMockTransport` function. This will resolve the "subscription.onUpdate is not a function" error.



**Tool Call: __tests__/.../useLiveQuery.test.tsx:         unsubscribe: vi.fn(() ... =>         unsubscribe: vi.fn(() ...**
Status: Completed

Diff: useLiveQuery.test.tsx
```
/**
 * Tests for useLiveQuery React hook
 * Validates live data fetching, real-time updates, and hook behavior
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useLiveQuery, useLiveQuerySuspense } from '../../src/react/useLiveQuery.js';
import { LiveQueryProvider } from '../../src/react/LiveQueryProvider.js';
import {
  LiveQueryClientConfig,
  LiveQueryError,
  LiveQueryUpdate,
  LiveQuerySubscription,
} from '../../src/live/types.js';
import { DatabaseClient } from '../../src/types/orm.js';

// Mock transport for testing
const createMockTransport = () => {
  const subscriptions = new Map<string, any>();
  let connectionState: any = 'disconnected';
  const connectionListeners = new Set<(state: any) => void>();
  const errorListeners = new Set<(error: LiveQueryError) => void>();

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getConnectionState: vi.fn(() => connectionState),
    onConnectionStateChange: vi.fn((listener) => {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    }),
    onError: vi.fn((listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    }),
    subscribe: vi.fn((query, variables, options) => {
      const id = `sub_${subscriptions.size + 1}`;
      const subscription = {
        id,
        query,
        variables: variables || {},
        connectionState,
        data: undefined,
        error: undefined,
        loading: true,
        unsubscribe: vi.fn(() => subscriptions.delete(id)),
        refetch: vi.fn().mockResolvedValue(undefined),
        onUpdate: vi.fn((callback) => {
          // Register the callback
          // Note: In this mock we don't strictly manage listeners, but we return cleanup
          return () => {};
        }),
      };
      subscriptions.set(id, subscription);
      return subscription;
    }),
    // Helper methods for testing
    _setConnectionState: (state: any) => {
      connectionState = state;
      connectionListeners.forEach(listener => listener(state));
    },
    _emitError: (error: LiveQueryError) => {
      errorListeners.forEach(listener => listener(error));
    },
    _updateSubscription: (id: string, data: any, loading = false, error?: LiveQueryError) => {
      const subscription = subscriptions.get(id);
      if (subscription) {
        subscription.data = data;
        subscription.loading = loading;
        subscription.error = error;
        // Trigger the update callback if it was registered (simulated)
        // Since we didn't store the callback in onUpdate, we can't call it here easily
        // BUT, looking at the tests, they use _updateSubscription to update the INTERNAL state
        // and expect the hook to react. 
        // The hook reacts via onUpdate callback. 
        // So we MUST store the callback.
      }
    },
    _getSubscriptions: () => subscriptions,
  };
};

const createMockCache = () => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  getKey: vi.fn((query, variables) => `${query}:${JSON.stringify(variables || {})}`),
});

const testConfig: LiveQueryClientConfig = {
  endpoint: 'http://localhost:4000/graphql',
  websocketUrl: 'ws://localhost:4000/graphql/ws',
};

// Test components
const TestComponent: React.FC<{
  queryFn: (db: DatabaseClient) => any;
  options?: any;
  onData?: (data: any) => void;
  onError?: (error: LiveQueryError) => void;
  onLoading?: (loading: boolean) => void;
}> = ({ queryFn, options, onData, onError, onLoading }) => {
  const result = useLiveQuery(queryFn, options);

  React.useEffect(() => {
    if (onData && result.data !== undefined) {
      onData(result.data);
    }
  }, [result.data, onData]);

  React.useEffect(() => {
    if (onError && result.error) {
      onError(result.error);
    }
  }, [result.error, onError]);

  React.useEffect(() => {
    if (onLoading !== undefined) {
      onLoading(result.loading);
    }
  }, [result.loading, onLoading]);

  return (
    <div>
      <div data-testid="loading">{String(result.loading)}</div>
      <div data-testid="connection-state">{result.connectionState}</div>
      <div data-testid="has-data">{String(!!result.data)}</div>
      <div data-testid="has-error">{String(!!result.error)}</div>
      <div data-testid="data">{result.data ? JSON.stringify(result.data) : 'null'}</div>
      <div data-testid="error">{result.error?.message || 'null'}</div>
    </div>
  );
};

const SuspenseTestComponent: React.FC<{
  queryFn: (db: DatabaseClient) => any;
  options?: any;
}> = ({ queryFn, options }) => {
  const result = useLiveQuerySuspense(queryFn, options);

  return (
    <div>
      <div data-testid="has-data">{String(!!result.data)}</div>
      <div data-testid="data">{result.data ? JSON.stringify(result.data) : 'null'}</div>
      <div data-testid="has-error">{String(!!result.error)}</div>
    </div>
  );
};

describe('useLiveQuery', () => {
  let mockTransport: ReturnType<typeof createMockTransport>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(() => {
    mockTransport = createMockTransport();
    mockCache = createMockCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  const renderWithProvider = (component: React.ReactElement) => {
    return render(
      <LiveQueryProvider
        config={testConfig}
        transport={mockTransport as any}
        cache={mockCache as any}
        autoConnect={false}
      >
        {component}
      </LiveQueryProvider>
    );
  };

  describe('Basic Hook Functionality', () => {
    it('should initialize with loading state', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      expect(screen.getByTestId('loading')).toHaveTextContent('true');
      expect(screen.getByTestId('has-data')).toHaveTextContent('false');
      expect(screen.getByTestId('has-error')).toHaveTextContent('false');
    });

    it('should create subscription when mounted', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      expect(mockTransport.subscribe).toHaveBeenCalledTimes(1);

      const subscribeCall = mockTransport.subscribe.mock.calls[0];
      expect(subscribeCall[0]).toContain('@live');
      expect(subscribeCall[0]).toContain('users');
    });

    it('should handle successful data updates', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const testData = { users: [{ id: '1', name: 'Test User' }] };

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      // Simulate data update
      await act(async () => {
        const subscriptions = mockTransport._getSubscriptions();
        const subscription = Array.from(subscriptions.values())[0];
        mockTransport._updateSubscription(subscription.id, testData, false);
      });

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('has-data')).toHaveTextContent('true');
        expect(screen.getByTestId('data')).toHaveTextContent(JSON.stringify(testData));
      });
    });

    it('should handle errors gracefully', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const testError: LiveQueryError = {
        code: 'QUERY_ERROR',
        message: 'Test error',
        timestamp: new Date(),
      };

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      // Simulate error
      await act(async () => {
        const subscriptions = mockTransport._getSubscriptions();
        const subscription = Array.from(subscriptions.values())[0];
        mockTransport._updateSubscription(subscription.id, undefined, false, testError);
      });

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('false');
        expect(screen.getByTestId('has-error')).toHaveTextContent('true');
        expect(screen.getByTestId('error')).toHaveTextContent('Test error');
      });
    });
  });

  describe('Query Function Variations', () => {
    it('should handle findUnique queries', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findUnique({ where: { id: '1' } });

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      expect(mockTransport.subscribe).toHaveBeenCalledTimes(1);

      const subscribeCall = mockTransport.subscribe.mock.calls[0];
      expect(subscribeCall[0]).toContain('@live');
      expect(subscribeCall[0]).toContain('user(');
    });

    it('should handle findFirst queries', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'desc' }
        });

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      expect(mockTransport.subscribe).toHaveBeenCalledTimes(1);

      const subscribeCall = mockTransport.subscribe.mock.calls[0];
      expect(subscribeCall[0]).toContain('@live');
      expect(subscribeCall[0]).toContain('user(');
    });

    it('should handle complex queries with relations', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({
          where: {
            AND: [
              { isActive: true },
              { posts: { some: { published: true } } }
            ]
          },
          include: {
            posts: {
              where: { published: true },
              take: 5
            },
            profile: true
          }
        });

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      expect(mockTransport.subscribe).toHaveBeenCalledTimes(1);

      const subscribeCall = mockTransport.subscribe.mock.calls[0];
      expect(subscribeCall[0]).toContain('@live');
      expect(subscribeCall[0]).toContain('posts {');
      expect(subscribeCall[0]).toContain('profile {');
    });
  });

  describe('Hook Options', () => {
    it('should respect suspend option', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      renderWithProvider(<TestComponent queryFn={queryFn} options={{ suspend: true }} />);

      // Should not create subscription when suspended
      expect(mockTransport.subscribe).not.toHaveBeenCalled();
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    it('should use cache when enabled', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const cachedData = { users: [{ id: '1', name: 'Cached User' }] };
      mockCache.get.mockReturnValue(cachedData);

      renderWithProvider(<TestComponent queryFn={queryFn} options={{ useCache: true }} />);

      await waitFor(() => {
        expect(mockCache.get).toHaveBeenCalled();
        expect(screen.getByTestId('data')).toHaveTextContent(JSON.stringify(cachedData));
      });
    });

    it('should call custom error handler', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const onError = vi.fn();
      const testError: LiveQueryError = {
        code: 'TEST_ERROR',
        message: 'Custom error',
        timestamp: new Date(),
      };

      renderWithProvider(
        <TestComponent queryFn={queryFn} options={{ onError }} />
      );

      // Simulate error
      await act(async () => {
        const subscriptions = mockTransport._getSubscriptions();
        const subscription = Array.from(subscriptions.values())[0];
        mockTransport._updateSubscription(subscription.id, undefined, false, testError);
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(testError);
      });
    });

    it('should call custom update handler', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const onUpdate = vi.fn();

      renderWithProvider(
        <TestComponent queryFn={queryFn} options={{ onUpdate }} />
      );

      // Note: In a real implementation, this would be called by the transport
      // For now, we just verify the option is passed correctly
      expect(mockTransport.subscribe).toHaveBeenCalledWith(
        expect.stringContaining('@live'),
        expect.any(Object),
        expect.objectContaining({ onUpdate })
      );
    });
  });

  describe('Connection State Changes', () => {
    it('should update connection state when transport changes', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      expect(screen.getByTestId('connection-state')).toHaveTextContent('disconnected');

      // Simulate connection state change
      await act(async () => {
        mockTransport._setConnectionState('connected');
      });

      await waitFor(() => {
        expect(screen.getByTestId('connection-state')).toHaveTextContent('connected');
      });
    });

    it('should refetch on reconnect when enabled', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      renderWithProvider(
        <TestComponent queryFn={queryFn} options={{ refetchOnReconnect: true }} />
      );

      // Get the subscription
      const subscriptions = mockTransport._getSubscriptions();
      const subscription = Array.from(subscriptions.values())[0];

      // Simulate reconnection
      await act(async () => {
        mockTransport._setConnectionState('connected');
      });

      await waitFor(() => {
        expect(subscription.refetch).toHaveBeenCalled();
      });
    });
  });

  describe('Dependencies and Re-renders', () => {
    it('should refetch when dependencies change', async () => {
      let userId = '1';

      const TestComponentWithDeps: React.FC = () => {
        const [currentUserId, setCurrentUserId] = React.useState(userId);

        const queryFn = React.useCallback(
          (db: DatabaseClient) => db.user.findUnique({ where: { id: currentUserId } }),
          [currentUserId]
        );

        const result = useLiveQuery(queryFn, {
          dependencies: [currentUserId]
        });

        return (
          <div>
            <div data-testid="user-id">{currentUserId}</div>
            <button
              data-testid="change-user"
              onClick={() => setCurrentUserId('2')}
            >
              Change User
            </button>
            <div data-testid="loading">{String(result.loading)}</div>
          </div>
        );
      };

      const { getByTestId } = renderWithProvider(<TestComponentWithDeps />);

      // Initial subscription
      expect(mockTransport.subscribe).toHaveBeenCalledTimes(1);

      // Change dependency
      await act(async () => {
        getByTestId('change-user').click();
      });

      // Should create new subscription
      await waitFor(() => {
        expect(mockTransport.subscribe).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Cleanup and Unmounting', () => {
    it('should unsubscribe when component unmounts', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const { unmount } = renderWithProvider(<TestComponent queryFn={queryFn} />);

      const subscriptions = mockTransport._getSubscriptions();
      const subscription = Array.from(subscriptions.values())[0];
      expect(subscription).toBeDefined();

      unmount();

      expect(subscription.unsubscribe).toHaveBeenCalled();
    });

    it('should handle cleanup properly', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const { unmount } = renderWithProvider(<TestComponent queryFn={queryFn} />);

      // Should not throw during cleanup
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Error Cases', () => {
    it('should handle invalid query functions', async () => {
      const invalidQueryFn = () => {
        return { invalid: 'result' };
      };

      expect(() => {
        renderWithProvider(<TestComponent queryFn={invalidQueryFn as any} />);
      }).toThrow('Failed to build GraphQL query');
    });

    it('should handle transport subscription failures', async () => {
      mockTransport.subscribe.mockImplementation(() => {
        throw new Error('Subscription failed');
      });

      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      await waitFor(() => {
        expect(screen.getByTestId('has-error')).toHaveTextContent('true');
        expect(screen.getByTestId('error')).toContain('Failed to create live query subscription');
      });
    });

    it('should handle missing transport gracefully', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      expect(() => {
        render(
          <LiveQueryProvider
            config={testConfig}
            transport={undefined as any}
            autoConnect={false}
          >
            <TestComponent queryFn={queryFn} />
          </LiveQueryProvider>
        );
      }).toThrow('useLiveQuery requires a transport instance');
    });
  });

  describe('useLiveQuerySuspense', () => {
    it('should suspend when loading and no data', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      let suspended = false;
      const SuspenseBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        return (
          <React.Suspense
            fallback={
              <div data-testid="suspense-loading">
                {(() => { suspended = true; return 'Loading...'; })()}
              </div>
            }
          >
            {children}
          </React.Suspense>
        );
      };

      renderWithProvider(
        <SuspenseBoundary>
          <SuspenseTestComponent queryFn={queryFn} />
        </SuspenseBoundary>
      );

      // Should show suspense fallback initially
      expect(screen.getByTestId('suspense-loading')).toBeInTheDocument();
      expect(suspended).toBe(true);
    });

    it('should resolve suspense when data is available', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const testData = { users: [{ id: '1', name: 'Test User' }] };

      const SuspenseBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
        return (
          <React.Suspense fallback={<div data-testid="suspense-loading">Loading...</div>}>
            {children}
          </React.Suspense>
        );
      };

      renderWithProvider(
        <SuspenseBoundary>
          <SuspenseTestComponent queryFn={queryFn} />
        </SuspenseBoundary>
      );

      // Simulate data arrival
      await act(async () => {
        const subscriptions = mockTransport._getSubscriptions();
        const subscription = Array.from(subscriptions.values())[0];
        mockTransport._updateSubscription(subscription.id, testData, false);
      });

      await waitFor(() => {
        expect(screen.queryByTestId('suspense-loading')).not.toBeInTheDocument();
        expect(screen.getByTestId('has-data')).toHaveTextContent('true');
      });
    });
  });

  describe('Real-time Updates', () => {
    it('should handle live data updates', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const initialData = { users: [{ id: '1', name: 'User 1' }] };
      const updatedData = { users: [{ id: '1', name: 'User 1' }, { id: '2', name: 'User 2' }] };

      renderWithProvider(<TestComponent queryFn={queryFn} />);

      // Initial data
      await act(async () => {
        const subscriptions = mockTransport._getSubscriptions();
        const subscription = Array.from(subscriptions.values())[0];
        mockTransport._updateSubscription(subscription.id, initialData, false);
      });

      await waitFor(() => {
        expect(screen.getByTestId('data')).toHaveTextContent(JSON.stringify(initialData));
      });

      // Live update
      await act(async () => {
        const subscriptions = mockTransport._getSubscriptions();
        const subscription = Array.from(subscriptions.values())[0];
        mockTransport._updateSubscription(subscription.id, updatedData, false);
      });

      await waitFor(() => {
        expect(screen.getByTestId('data')).toHaveTextContent(JSON.stringify(updatedData));
      });
    });

    it('should cache updated data when caching is enabled', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      const testData = { users: [{ id: '1', name: 'Test User' }] };

      renderWithProvider(<TestComponent queryFn={queryFn} options={{ useCache: true }} />);

      await act(async () => {
        const subscriptions = mockTransport._getSubscriptions();
        const subscription = Array.from(subscriptions.values())[0];
        mockTransport._updateSubscription(subscription.id, testData, false);
      });

      await waitFor(() => {
        expect(mockCache.set).toHaveBeenCalledWith(
          expect.any(String),
          testData
        );
      });
    });
  });

  describe('Refetch Functionality', () => {
    it('should provide refetch function', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      let refetchFn: (() => Promise<void>) | undefined;

      const TestRefetchComponent: React.FC = () => {
        const result = useLiveQuery(queryFn);
        refetchFn = result.refetch;

        return (
          <div>
            <div data-testid="has-refetch">{String(!!result.refetch)}</div>
          </div>
        );
      };

      renderWithProvider(<TestRefetchComponent />);

      expect(screen.getByTestId('has-refetch')).toHaveTextContent('true');
      expect(refetchFn).toBeDefined();
    });

    it('should call subscription refetch when refetch is called', async () => {
      const queryFn = (db: DatabaseClient) =>
        db.user.findMany({ where: { isActive: true } });

      let refetchFn: (() => Promise<void>) | undefined;

      const TestRefetchComponent: React.FC = () => {
        const result = useLiveQuery(queryFn);
        refetchFn = result.refetch;
        return <div />;
      };

      renderWithProvider(<TestRefetchComponent />);

      const subscriptions = mockTransport._getSubscriptions();
      const subscription = Array.from(subscriptions.values())[0];

      await act(async () => {
        await refetchFn!();
      });

      expect(subscription.refetch).toHaveBeenCalled();
    });
  });
});

```


## Assistant

<thinking>
**Evaluating the Implementation**

My current concern is the test implementation of `useLiveQuery.test.tsx`. The naive approach of a no-op `onUpdate` is insufficient. The React state updates hinge on the `onUpdate` callback. Therefore, I need to design a test that actively verifies state changes triggered by `_updateSubscription`.


**Revising Test Strategy**

I've realized that the initial approach to mocking `onUpdate` was too simplistic. Now, I'm refactoring the mock transport to store the `onUpdate` callbacks, which requires tracking listeners using a `Set`. This will allow me to actively invoke the callback when `_updateSubscription` is triggered, verifying that state changes are correctly propagated. I'm focusing on ensuring proper callback registration and execution within the test environment.


**Adapting Mock WebSocket**

I'm now focused on the `MockWebSocket` implementation within `transport.test.ts`. Specifically, I need to handle the `connection_init` message and send a `connection_ack` response. This is essential for the WebSocket to correctly establish the connection and subsequently allow for subscription operations. This is the first step in properly mocking the transport, paving the way for more thorough testing.


**Addressing Transport Implementation**

I'm now focused on the implementation of `MockWebSocket` in `__tests__/live/transport.test.ts`. I need to handle `connection_init` messages and send a `connection_ack` response to correctly establish the WebSocket connection. After that, I also need to adjust the expectations in the  `should handle queued subscriptions` test. I will integrate these changes directly into the testing environment to ensure the transport logic functions correctly.



</thinking>

I will modify `__tests__/live/transport.test.ts` to update `MockWebSocket` to handle `connection_init` messages by responding with `connection_ack`, preventing timeouts. I will also update the "should handle queued subscriptions when disconnected" test case to expect the connection state to be "connecting" instead of "disconnected", reflecting the new auto-connect behavior.



**Tool Call: __tests__/live/transport.test.ts:     // Echo back subscription ... =>     // Echo back subscription ...**
Status: Completed

Diff: transport.test.ts
```
/**
 * Tests for live query transport functionality
 * Validates WebSocket-based real-time query transport implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketLiveQueryTransport } from "../../src/live/transport.js";
import {
  LiveQueryConnectionState,
  LiveQueryError,
} from "../../src/live/types.js";
import { User } from "../../src/types/orm.js";

// Enable test mode for private field access
(global as any).__TEST_MODE__ = true;

// Mock WebSocket for testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event("open"));
      }
    }, 10);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    // Echo back subscription confirmations
    const message = JSON.parse(data);

    if (message.type === "connection_init") {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", {
              data: JSON.stringify({ type: "connection_ack" }),
            }),
          );
        }
      }, 5);
    }

    if (message.type === "subscribe") {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "data",
                id: message.id,
                payload: {
                  data: { users: [{ id: "1", name: "Test User" }] },
                },
              }),
            }),
          );
        }
      }, 5);
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Helper method to simulate receiving messages
  simulateMessage(message: any) {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent("message", {
          data: JSON.stringify(message),
        }),
      );
    }
  }

  // Helper method to simulate connection errors
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }
}

// Mock global WebSocket
global.WebSocket = MockWebSocket as any;

function mockWebSocket(obj: unknown) {
  const isMockWebSocket = (obj: unknown): obj is MockWebSocket =>
    !!obj && typeof obj === "object" && "simulateMessage" in obj;

  if (isMockWebSocket(obj)) {
    return obj;
  }

  throw new Error("Unexpected test state");
}

describe("WebSocketLiveQueryTransport", () => {
  let transport: WebSocketLiveQueryTransport;
  const testUrl = "ws://localhost:4000/graphql/ws";

  beforeEach(() => {
    transport = new WebSocketLiveQueryTransport(testUrl, { debug: true });
  });

  afterEach(async () => {
    await transport.disconnect();
    vi.clearAllTimers();
  });

  describe("Connection Management", () => {
    it("should initialize with disconnected state", () => {
      expect(transport.getConnectionState()).toBe("disconnected");
    });

    it("should connect successfully", async () => {
      const stateChanges: LiveQueryConnectionState[] = [];
      transport.onConnectionStateChange((state) => {
        stateChanges.push(state);
      });

      await transport.connect();

      expect(transport.getConnectionState()).toBe("connected");
      expect(stateChanges).toContain("connecting");
      expect(stateChanges).toContain("connected");
    });

    it("should handle connection errors", async () => {
      const errors: LiveQueryError[] = [];
      transport.onError((error) => {
        errors.push(error);
      });

      // Override WebSocket to throw error
      const originalWebSocket = global.WebSocket;
      global.WebSocket = class extends originalWebSocket {
        constructor(url: string) {
          super(url);
          // @ts-expect-error - Calling invalid function to simulate error
          setTimeout(() => this.simulateError(), 5);
        }
      } as typeof WebSocket;

      await expect(transport.connect()).rejects.toThrow();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.code).toBe("CONNECTION_FAILED");

      global.WebSocket = originalWebSocket;
    });

    it("should disconnect properly", async () => {
      await transport.connect();
      expect(transport.getConnectionState()).toBe("connected");

      await transport.disconnect();
      expect(transport.getConnectionState()).toBe("closed");
    });
  });

  describe("Subscription Management", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("should create subscriptions", () => {
      const query = "query GetUsers @live { users { id name } }";
      const variables = { limit: 10 };

      const subscription = transport.subscribe(query, variables);

      expect(subscription).toBeDefined();
      expect(subscription.id).toMatch(/^sub_\d+$/);
      expect(subscription.query).toBe(query);
      expect(subscription.variables).toEqual(variables);
      expect(subscription.connectionState).toBe("connected");
    });

    it("should handle subscription data updates", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe<{ users: User[] }>(query);

      // Wait for initial data
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(subscription.loading).toBe(false);
      expect(subscription.data).toBeDefined();
      expect(subscription.data?.users).toHaveLength(1);
      expect(subscription.data?.users[0].name).toBe("Test User");
    });

    it("should handle subscription errors", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      // Simulate error message
      const mockWs = mockWebSocket(transport.__testWebSocket);
      mockWs?.simulateMessage({
        type: "error",
        id: subscription.id,
        payload: {
          code: "QUERY_ERROR",
          message: "Invalid query",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscription.loading).toBe(false);
      expect(subscription.error).toBeDefined();
      expect(subscription.error?.code).toBe("QUERY_ERROR");
      expect(subscription.error?.message).toBe("Invalid query");
    });

    it("should handle live updates", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      // Wait for initial data
      await new Promise((resolve) => setTimeout(resolve, 20));

      const initialData = subscription.data;
      expect(initialData).toBeDefined();

      // Simulate live update
      const mockWs = mockWebSocket(transport.__testWebSocket);
      const updatedData = {
        users: [
          { id: "1", name: "Test User" },
          { id: "2", name: "New User" },
        ],
      };

      mockWs?.simulateMessage({
        type: "update",
        id: subscription.id,
        payload: {
          updateType: "insert",
          result: updatedData,
          timestamp: new Date().toISOString(),
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscription.data).toEqual(updatedData);
      expect(subscription.data?.users).toHaveLength(2);
    });

    it("should unsubscribe properly", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      expect(subscription).toBeDefined();

      // Mock the WebSocket send method to track unsubscribe messages
      const mockWs = mockWebSocket(transport.__testWebSocket);

      const sentMessages: any[] = [];
      const originalSend = mockWs.send.bind(mockWs);
      mockWs.send = (data: string) => {
        sentMessages.push(JSON.parse(data));
        originalSend(data);
      };

      subscription.unsubscribe();

      const unsubscribeMessage = sentMessages.find(
        (msg) => msg.type === "unsubscribe",
      );
      expect(unsubscribeMessage).toBeDefined();
      expect(unsubscribeMessage.id).toBe(subscription.id);
    });

    it("should refetch subscriptions", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(subscription.loading).toBe(false);

      // Mock the WebSocket send method to track refetch
      const mockWs = mockWebSocket(transport.__testWebSocket);
      const sentMessages: any[] = [];
      const originalSend = mockWs.send.bind(mockWs);
      mockWs.send = (data: string) => {
        sentMessages.push(JSON.parse(data));
        originalSend(data);
      };

      await subscription.refetch();

      // Should have sent another subscription message
      const subscriptionMessages = sentMessages.filter(
        (msg) => msg.type === "subscribe",
      );
      expect(subscriptionMessages.length).toBeGreaterThan(0);
    });
  });

  describe("Reconnection Logic", () => {
    it("should attempt reconnection on disconnect", async () => {
      const transport = new WebSocketLiveQueryTransport(testUrl, {
        autoReconnect: true,
        maxReconnectAttempts: 2,
        reconnectDelay: 50,
      });

      const stateChanges: LiveQueryConnectionState[] = [];
      transport.onConnectionStateChange((state) => {
        stateChanges.push(state);
      });

      await transport.connect();
      expect(transport.getConnectionState()).toBe("connected");

      // Simulate disconnect
      const mockWs = mockWebSocket(transport.__testWebSocket);
      mockWs?.close();

      // Wait for reconnection attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(stateChanges).toContain("disconnected");
      expect(stateChanges).toContain("reconnecting");
    });

    it("should stop reconnecting after max attempts", async () => {
      const transport = new WebSocketLiveQueryTransport(testUrl, {
        autoReconnect: true,
        maxReconnectAttempts: 1,
        reconnectDelay: 10,
      });

      const errors: LiveQueryError[] = [];
      transport.onError((error) => {
        errors.push(error);
      });

      // Override WebSocket to always fail
      global.WebSocket = class {
        constructor() {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror(new Event("error"));
            }
          }, 5);
        }
        close() {}
        send() {}
        readyState = 0;
        onopen: any = null;
        onmessage: any = null;
        onclose: any = null;
        onerror: any = null;
      } as any;

      await expect(transport.connect()).rejects.toThrow();

      // Wait for reconnection attempts
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(transport.getConnectionState()).toBe("error");
      const maxAttemptError = errors.find(
        (e) => e.code === "MAX_RECONNECT_ATTEMPTS",
      );
      expect(maxAttemptError).toBeDefined();
    });
  });

  describe("Options and Configuration", () => {
    it("should use custom options", () => {
      const customOptions = {
        autoReconnect: false,
        maxReconnectAttempts: 10,
        reconnectDelay: 2000,
        debug: false,
      };

      const transport = new WebSocketLiveQueryTransport(testUrl, customOptions);
      expect(transport).toBeDefined();
    });

    it("should handle queued subscriptions when disconnected", async () => {
      const transport = new WebSocketLiveQueryTransport(testUrl);

      // Create subscription while disconnected
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      expect(subscription.connectionState).toBe("disconnected");
      expect(subscription.loading).toBe(true);

      // Connect and verify subscription is processed
      await transport.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(subscription.connectionState).toBe("connected");
      expect(subscription.data).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle JSON parse errors in messages", async () => {
      await transport.connect();

      const mockWs = mockWebSocket(transport.__testWebSocket);

      // Send invalid JSON
      if (mockWs.onmessage) {
        mockWs.onmessage(
          new MessageEvent("message", {
            data: "invalid json",
          }),
        );
      }

      // Should not crash, just log error in debug mode
      expect(transport.getConnectionState()).toBe("connected");
    });

    it("should handle unknown message types", async () => {
      await transport.connect();

      const subscription = transport.subscribe("query { users { id } }");
      const mockWs = mockWebSocket(transport.__testWebSocket);

      mockWs.simulateMessage({
        type: "unknown",
        id: subscription.id,
        payload: { data: "test" },
      });

      // Should not crash
      expect(transport.getConnectionState()).toBe("connected");
    });

    it("should handle messages for unknown subscriptions", async () => {
      await transport.connect();

      const mockWs = mockWebSocket(transport.__testWebSocket);

      mockWs.simulateMessage({
        type: "data",
        id: "unknown-subscription-id",
        payload: { data: { users: [] } },
      });

      // Should not crash
      expect(transport.getConnectionState()).toBe("connected");
    });
  });
});

```


**Tool Call: __tests__/live/transport.test.ts:       const query = "query Get... =>       const query = "query Get...**
Status: Completed

Diff: transport.test.ts
```
/**
 * Tests for live query transport functionality
 * Validates WebSocket-based real-time query transport implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketLiveQueryTransport } from "../../src/live/transport.js";
import {
  LiveQueryConnectionState,
  LiveQueryError,
} from "../../src/live/types.js";
import { User } from "../../src/types/orm.js";

// Enable test mode for private field access
(global as any).__TEST_MODE__ = true;

// Mock WebSocket for testing
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection after a short delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event("open"));
      }
    }, 10);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    // Echo back subscription confirmations
    const message = JSON.parse(data);

    if (message.type === "connection_init") {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", {
              data: JSON.stringify({ type: "connection_ack" }),
            }),
          );
        }
      }, 5);
    }

    if (message.type === "subscribe") {
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "data",
                id: message.id,
                payload: {
                  data: { users: [{ id: "1", name: "Test User" }] },
                },
              }),
            }),
          );
        }
      }, 5);
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Helper method to simulate receiving messages
  simulateMessage(message: any) {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent("message", {
          data: JSON.stringify(message),
        }),
      );
    }
  }

  // Helper method to simulate connection errors
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }
}

// Mock global WebSocket
global.WebSocket = MockWebSocket as any;

function mockWebSocket(obj: unknown) {
  const isMockWebSocket = (obj: unknown): obj is MockWebSocket =>
    !!obj && typeof obj === "object" && "simulateMessage" in obj;

  if (isMockWebSocket(obj)) {
    return obj;
  }

  throw new Error("Unexpected test state");
}

describe("WebSocketLiveQueryTransport", () => {
  let transport: WebSocketLiveQueryTransport;
  const testUrl = "ws://localhost:4000/graphql/ws";

  beforeEach(() => {
    transport = new WebSocketLiveQueryTransport(testUrl, { debug: true });
  });

  afterEach(async () => {
    await transport.disconnect();
    vi.clearAllTimers();
  });

  describe("Connection Management", () => {
    it("should initialize with disconnected state", () => {
      expect(transport.getConnectionState()).toBe("disconnected");
    });

    it("should connect successfully", async () => {
      const stateChanges: LiveQueryConnectionState[] = [];
      transport.onConnectionStateChange((state) => {
        stateChanges.push(state);
      });

      await transport.connect();

      expect(transport.getConnectionState()).toBe("connected");
      expect(stateChanges).toContain("connecting");
      expect(stateChanges).toContain("connected");
    });

    it("should handle connection errors", async () => {
      const errors: LiveQueryError[] = [];
      transport.onError((error) => {
        errors.push(error);
      });

      // Override WebSocket to throw error
      const originalWebSocket = global.WebSocket;
      global.WebSocket = class extends originalWebSocket {
        constructor(url: string) {
          super(url);
          // @ts-expect-error - Calling invalid function to simulate error
          setTimeout(() => this.simulateError(), 5);
        }
      } as typeof WebSocket;

      await expect(transport.connect()).rejects.toThrow();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]?.code).toBe("CONNECTION_FAILED");

      global.WebSocket = originalWebSocket;
    });

    it("should disconnect properly", async () => {
      await transport.connect();
      expect(transport.getConnectionState()).toBe("connected");

      await transport.disconnect();
      expect(transport.getConnectionState()).toBe("closed");
    });
  });

  describe("Subscription Management", () => {
    beforeEach(async () => {
      await transport.connect();
    });

    it("should create subscriptions", () => {
      const query = "query GetUsers @live { users { id name } }";
      const variables = { limit: 10 };

      const subscription = transport.subscribe(query, variables);

      expect(subscription).toBeDefined();
      expect(subscription.id).toMatch(/^sub_\d+$/);
      expect(subscription.query).toBe(query);
      expect(subscription.variables).toEqual(variables);
      expect(subscription.connectionState).toBe("connected");
    });

    it("should handle subscription data updates", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe<{ users: User[] }>(query);

      // Wait for initial data
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(subscription.loading).toBe(false);
      expect(subscription.data).toBeDefined();
      expect(subscription.data?.users).toHaveLength(1);
      expect(subscription.data?.users[0].name).toBe("Test User");
    });

    it("should handle subscription errors", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      // Simulate error message
      const mockWs = mockWebSocket(transport.__testWebSocket);
      mockWs?.simulateMessage({
        type: "error",
        id: subscription.id,
        payload: {
          code: "QUERY_ERROR",
          message: "Invalid query",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscription.loading).toBe(false);
      expect(subscription.error).toBeDefined();
      expect(subscription.error?.code).toBe("QUERY_ERROR");
      expect(subscription.error?.message).toBe("Invalid query");
    });

    it("should handle live updates", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      // Wait for initial data
      await new Promise((resolve) => setTimeout(resolve, 20));

      const initialData = subscription.data;
      expect(initialData).toBeDefined();

      // Simulate live update
      const mockWs = mockWebSocket(transport.__testWebSocket);
      const updatedData = {
        users: [
          { id: "1", name: "Test User" },
          { id: "2", name: "New User" },
        ],
      };

      mockWs?.simulateMessage({
        type: "update",
        id: subscription.id,
        payload: {
          updateType: "insert",
          result: updatedData,
          timestamp: new Date().toISOString(),
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(subscription.data).toEqual(updatedData);
      expect(subscription.data?.users).toHaveLength(2);
    });

    it("should unsubscribe properly", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      expect(subscription).toBeDefined();

      // Mock the WebSocket send method to track unsubscribe messages
      const mockWs = mockWebSocket(transport.__testWebSocket);

      const sentMessages: any[] = [];
      const originalSend = mockWs.send.bind(mockWs);
      mockWs.send = (data: string) => {
        sentMessages.push(JSON.parse(data));
        originalSend(data);
      };

      subscription.unsubscribe();

      const unsubscribeMessage = sentMessages.find(
        (msg) => msg.type === "unsubscribe",
      );
      expect(unsubscribeMessage).toBeDefined();
      expect(unsubscribeMessage.id).toBe(subscription.id);
    });

    it("should refetch subscriptions", async () => {
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(subscription.loading).toBe(false);

      // Mock the WebSocket send method to track refetch
      const mockWs = mockWebSocket(transport.__testWebSocket);
      const sentMessages: any[] = [];
      const originalSend = mockWs.send.bind(mockWs);
      mockWs.send = (data: string) => {
        sentMessages.push(JSON.parse(data));
        originalSend(data);
      };

      await subscription.refetch();

      // Should have sent another subscription message
      const subscriptionMessages = sentMessages.filter(
        (msg) => msg.type === "subscribe",
      );
      expect(subscriptionMessages.length).toBeGreaterThan(0);
    });
  });

  describe("Reconnection Logic", () => {
    it("should attempt reconnection on disconnect", async () => {
      const transport = new WebSocketLiveQueryTransport(testUrl, {
        autoReconnect: true,
        maxReconnectAttempts: 2,
        reconnectDelay: 50,
      });

      const stateChanges: LiveQueryConnectionState[] = [];
      transport.onConnectionStateChange((state) => {
        stateChanges.push(state);
      });

      await transport.connect();
      expect(transport.getConnectionState()).toBe("connected");

      // Simulate disconnect
      const mockWs = mockWebSocket(transport.__testWebSocket);
      mockWs?.close();

      // Wait for reconnection attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(stateChanges).toContain("disconnected");
      expect(stateChanges).toContain("reconnecting");
    });

    it("should stop reconnecting after max attempts", async () => {
      const transport = new WebSocketLiveQueryTransport(testUrl, {
        autoReconnect: true,
        maxReconnectAttempts: 1,
        reconnectDelay: 10,
      });

      const errors: LiveQueryError[] = [];
      transport.onError((error) => {
        errors.push(error);
      });

      // Override WebSocket to always fail
      global.WebSocket = class {
        constructor() {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror(new Event("error"));
            }
          }, 5);
        }
        close() {}
        send() {}
        readyState = 0;
        onopen: any = null;
        onmessage: any = null;
        onclose: any = null;
        onerror: any = null;
      } as any;

      await expect(transport.connect()).rejects.toThrow();

      // Wait for reconnection attempts
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(transport.getConnectionState()).toBe("error");
      const maxAttemptError = errors.find(
        (e) => e.code === "MAX_RECONNECT_ATTEMPTS",
      );
      expect(maxAttemptError).toBeDefined();
    });
  });

  describe("Options and Configuration", () => {
    it("should use custom options", () => {
      const customOptions = {
        autoReconnect: false,
        maxReconnectAttempts: 10,
        reconnectDelay: 2000,
        debug: false,
      };

      const transport = new WebSocketLiveQueryTransport(testUrl, customOptions);
      expect(transport).toBeDefined();
    });

    it("should handle queued subscriptions when disconnected", async () => {
      const transport = new WebSocketLiveQueryTransport(testUrl);

      // Create subscription while disconnected
      const query = "query GetUsers @live { users { id name } }";
      const subscription = transport.subscribe(query);

      expect(subscription.connectionState).toBe("connecting");
      expect(subscription.loading).toBe(true);

      // Connect and verify subscription is processed
      await transport.connect();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(subscription.connectionState).toBe("connected");
      expect(subscription.data).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle JSON parse errors in messages", async () => {
      await transport.connect();

      const mockWs = mockWebSocket(transport.__testWebSocket);

      // Send invalid JSON
      if (mockWs.onmessage) {
        mockWs.onmessage(
          new MessageEvent("message", {
            data: "invalid json",
          }),
        );
      }

      // Should not crash, just log error in debug mode
      expect(transport.getConnectionState()).toBe("connected");
    });

    it("should handle unknown message types", async () => {
      await transport.connect();

      const subscription = transport.subscribe("query { users { id } }");
      const mockWs = mockWebSocket(transport.__testWebSocket);

      mockWs.simulateMessage({
        type: "unknown",
        id: subscription.id,
        payload: { data: "test" },
      });

      // Should not crash
      expect(transport.getConnectionState()).toBe("connected");
    });

    it("should handle messages for unknown subscriptions", async () => {
      await transport.connect();

      const mockWs = mockWebSocket(transport.__testWebSocket);

      mockWs.simulateMessage({
        type: "data",
        id: "unknown-subscription-id",
        payload: { data: { users: [] } },
      });

      // Should not crash
      expect(transport.getConnectionState()).toBe("connected");
    });
  });
});

```


