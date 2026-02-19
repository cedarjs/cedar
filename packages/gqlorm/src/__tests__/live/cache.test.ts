/**
 * Tests for live query cache functionality
 * Validates in-memory cache implementation for query results
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InMemoryLiveQueryCache,
  createLiveQueryCache,
} from "../../src/live/cache.js";

describe("InMemoryLiveQueryCache", () => {
  let cache: InMemoryLiveQueryCache;

  beforeEach(() => {
    cache = new InMemoryLiveQueryCache();
  });

  describe("Basic Operations", () => {
    it("should store and retrieve values", () => {
      const key = "test-key";
      const value = { users: [{ id: "1", name: "Test User" }] };

      cache.set(key, value);
      const retrieved = cache.get(key);

      expect(retrieved).toEqual(value);
    });

    it("should return undefined for non-existent keys", () => {
      const result = cache.get("non-existent-key");
      expect(result).toBeUndefined();
    });

    it("should remove values", () => {
      const key = "test-key";
      const value = { data: "test" };

      cache.set(key, value);
      expect(cache.get(key)).toEqual(value);

      cache.remove(key);
      expect(cache.get(key)).toBeUndefined();
    });

    it("should clear all values", () => {
      cache.set("key1", { data: "value1" });
      cache.set("key2", { data: "value2" });

      expect(cache.get("key1")).toBeDefined();
      expect(cache.get("key2")).toBeDefined();

      cache.clear();

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBeUndefined();
    });
  });

  describe("Key Generation", () => {
    it("should generate consistent keys for same query", () => {
      const query = "query GetUsers { users { id name } }";
      const variables = { limit: 10, offset: 0 };

      const key1 = cache.getKey(query, variables);
      const key2 = cache.getKey(query, variables);

      expect(key1).toBe(key2);
    });

    it("should generate different keys for different queries", () => {
      const query1 = "query GetUsers { users { id name } }";
      const query2 = "query GetPosts { posts { id title } }";

      const key1 = cache.getKey(query1);
      const key2 = cache.getKey(query2);

      expect(key1).not.toBe(key2);
    });

    it("should generate different keys for different variables", () => {
      const query = "query GetUsers { users { id name } }";
      const variables1 = { limit: 10 };
      const variables2 = { limit: 20 };

      const key1 = cache.getKey(query, variables1);
      const key2 = cache.getKey(query, variables2);

      expect(key1).not.toBe(key2);
    });

    it("should generate same keys regardless of variable order", () => {
      const query = "query GetUsers { users { id name } }";
      const variables1 = { limit: 10, offset: 0, sort: "name" };
      const variables2 = { sort: "name", offset: 0, limit: 10 };

      const key1 = cache.getKey(query, variables1);
      const key2 = cache.getKey(query, variables2);

      expect(key1).toBe(key2);
    });

    it("should handle queries without variables", () => {
      const query = "query GetUsers { users { id name } }";

      const key1 = cache.getKey(query);
      const key2 = cache.getKey(query, undefined);
      const key3 = cache.getKey(query, {});

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3); // empty object is different from no variables
    });
  });

  describe("TTL (Time To Live)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should expire entries after TTL", () => {
      const cache = new InMemoryLiveQueryCache({ ttl: 1000 }); // 1 second TTL
      const key = "test-key";
      const value = { data: "test" };

      cache.set(key, value);
      expect(cache.get(key)).toEqual(value);

      // Advance time by 1.5 seconds
      vi.advanceTimersByTime(1500);

      expect(cache.get(key)).toBeUndefined();
    });

    it("should not expire entries before TTL", () => {
      const cache = new InMemoryLiveQueryCache({ ttl: 1000 }); // 1 second TTL
      const key = "test-key";
      const value = { data: "test" };

      cache.set(key, value);
      expect(cache.get(key)).toEqual(value);

      // Advance time by 0.5 seconds
      vi.advanceTimersByTime(500);

      expect(cache.get(key)).toEqual(value);
    });

    it("should update last accessed time on get", () => {
      const cache = new InMemoryLiveQueryCache({ ttl: 1000 });
      const key = "test-key";
      const value = { data: "test" };

      cache.set(key, value);

      // Advance time but access within TTL
      vi.advanceTimersByTime(500);
      const retrieved = cache.get(key);
      expect(retrieved).toEqual(value);

      // Advance time again, should still be available due to recent access
      vi.advanceTimersByTime(700);
      expect(cache.get(key)).toEqual(value);
    });

    it("should allow updating TTL for existing entries", () => {
      const cache = new InMemoryLiveQueryCache({ ttl: 1000 });
      const key = "test-key";
      const value = { data: "test" };

      cache.set(key, value);

      // Advance time close to expiry
      vi.advanceTimersByTime(900);
      expect(cache.get(key)).toEqual(value);

      // Update TTL to longer duration
      cache.updateTTL(2000);

      // Advance time beyond original TTL
      vi.advanceTimersByTime(500);
      expect(cache.get(key)).toEqual(value); // Should still be available
    });
  });

  describe("Size Limits and Eviction", () => {
    it("should respect max size limit", () => {
      const cache = new InMemoryLiveQueryCache({ maxSize: 3 });

      cache.set("key1", { data: "value1" });
      cache.set("key2", { data: "value2" });
      cache.set("key3", { data: "value3" });

      expect(cache.get("key1")).toBeDefined();
      expect(cache.get("key2")).toBeDefined();
      expect(cache.get("key3")).toBeDefined();

      // Adding 4th item should evict oldest
      cache.set("key4", { data: "value4" });

      expect(cache.get("key1")).toBeUndefined(); // Should be evicted
      expect(cache.get("key2")).toBeDefined();
      expect(cache.get("key3")).toBeDefined();
      expect(cache.get("key4")).toBeDefined();
    });

    it("should evict least recently used items", () => {
      const cache = new InMemoryLiveQueryCache({ maxSize: 3 });

      cache.set("key1", { data: "value1" });
      cache.set("key2", { data: "value2" });
      cache.set("key3", { data: "value3" });

      // Access key1 to make it recently used
      cache.get("key1");

      // Add new item, should evict key2 (least recently used)
      cache.set("key4", { data: "value4" });

      expect(cache.get("key1")).toBeDefined(); // Should still be there
      expect(cache.get("key2")).toBeUndefined(); // Should be evicted
      expect(cache.get("key3")).toBeDefined();
      expect(cache.get("key4")).toBeDefined();
    });

    it("should not evict when updating existing keys", () => {
      const cache = new InMemoryLiveQueryCache({ maxSize: 2 });

      cache.set("key1", { data: "value1" });
      cache.set("key2", { data: "value2" });

      // Update existing key should not trigger eviction
      cache.set("key1", { data: "updated-value1" });

      expect(cache.get("key1")).toEqual({ data: "updated-value1" });
      expect(cache.get("key2")).toBeDefined();
    });
  });

  describe("Statistics and Monitoring", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should provide cache statistics", () => {
      const cache = new InMemoryLiveQueryCache({ maxSize: 10, ttl: 1000 });

      cache.set("key1", { data: "value1" });
      cache.set("key2", { data: "value2" });

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10);
      expect(stats.expiredCount).toBe(0);
    });

    it("should track expired entries in statistics", () => {
      const cache = new InMemoryLiveQueryCache({ ttl: 1000 });

      cache.set("key1", { data: "value1" });
      cache.set("key2", { data: "value2" });

      // Advance time to expire entries
      vi.advanceTimersByTime(1500);

      const stats = cache.getStats();

      expect(stats.expiredCount).toBe(2);
    });

    it("should cleanup expired entries", () => {
      const cache = new InMemoryLiveQueryCache({ ttl: 1000 });

      cache.set("key1", { data: "value1" });
      cache.set("key2", { data: "value2" });
      cache.set("key3", { data: "value3" });

      // Advance time to expire some entries
      vi.advanceTimersByTime(1500);

      let stats = cache.getStats();
      expect(stats.size).toBe(3); // Still in memory
      expect(stats.expiredCount).toBe(3);

      cache.cleanup();

      stats = cache.getStats();
      expect(stats.size).toBe(0); // Cleaned up
      expect(stats.expiredCount).toBe(0);
    });

    it("should cleanup only expired entries", () => {
      const cache = new InMemoryLiveQueryCache({ ttl: 1000 });

      cache.set("key1", { data: "value1" });

      // Advance time partially
      vi.advanceTimersByTime(500);

      cache.set("key2", { data: "value2" }); // This should not be expired

      // Advance time to expire first entry
      vi.advanceTimersByTime(600);

      cache.cleanup();

      expect(cache.get("key1")).toBeUndefined(); // Expired and cleaned
      expect(cache.get("key2")).toBeDefined(); // Still valid
    });
  });

  describe("Edge Cases", () => {
    it("should handle null and undefined values", () => {
      cache.set("null-key", null);
      cache.set("undefined-key", undefined);

      expect(cache.get("null-key")).toBe(null);
      expect(cache.get("undefined-key")).toBe(undefined);
    });

    it("should handle complex nested objects", () => {
      const complexValue = {
        users: [
          {
            id: "1",
            name: "Test User",
            profile: {
              email: "test@example.com",
              settings: {
                theme: "dark",
                notifications: true,
              },
            },
            posts: [
              { id: "p1", title: "Post 1" },
              { id: "p2", title: "Post 2" },
            ],
          },
        ],
        metadata: {
          total: 1,
          hasNext: false,
        },
      };

      cache.set("complex-key", complexValue);
      const retrieved = cache.get<typeof complexValue>("complex-key");

      expect(retrieved).toEqual(complexValue);
      expect(retrieved?.users[0].profile.settings.theme).toBe("dark");
    });

    it("should handle empty cache operations", () => {
      // Operations on empty cache should not crash
      cache.cleanup();
      cache.clear();
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.expiredCount).toBe(0);
    });

    it("should handle concurrent operations", () => {
      const key = "concurrent-key";

      // Simulate concurrent set/get operations
      cache.set(key, { data: "value1" });
      const value1 = cache.get(key);
      cache.set(key, { data: "value2" });
      const value2 = cache.get(key);

      expect(value1).toEqual({ data: "value1" });
      expect(value2).toEqual({ data: "value2" });
    });
  });

  describe("Factory Function", () => {
    it("should create cache with default options", () => {
      const cache = createLiveQueryCache();
      expect(cache).toBeDefined();

      cache.set("test", { data: "test" });
      expect(cache.get("test")).toEqual({ data: "test" });
    });

    it("should create cache with custom options", () => {
      const cache = createLiveQueryCache({
        maxSize: 100,
        ttl: 60000,
      });

      expect(cache).toBeDefined();

      const stats = cache.getStats();
      expect(stats.maxSize).toBe(100);
    });
  });
});
