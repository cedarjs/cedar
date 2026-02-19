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
