/**
 * Tests for @live directive GraphQL query generation
 * Validates that queries are properly modified to include @live directive for real-time updates
 */

import { describe, it, expect } from "vitest";
import {
  buildQuery,
  buildLiveQuery,
  buildQueryFromFunction,
  buildLiveQueryFromFunction,
  QueryBuilder,
} from "../../src/query-builder.js";
import {
  createLiveQuery,
  isLiveQuery,
  removeLiveDirective,
} from "../../src/live/index.js";

describe("@live Directive Query Generation", () => {
  describe("Query Builder Integration", () => {
    it("should generate regular queries without @live directive by default", () => {
      const result = buildQuery("user", "findMany", {
        where: { isActive: true },
        select: { id: true, name: true },
      });

      expect(result.query).toContain("users");
      expect(result.query).not.toContain("@live");
    });

    it("should generate live queries with @live directive when explicitly requested", () => {
      const result = buildQuery(
        "user",
        "findMany",
        {
          where: { isActive: true },
          select: { id: true, name: true },
        },
        { isLive: true },
      );

      expect(result.query).toContain("@live");
      expect(result.query).toContain("query findManyUser");
    });

    it("should use buildLiveQuery convenience function", () => {
      const result = buildLiveQuery("user", "findMany", {
        where: { isActive: true },
        select: { id: true, name: true },
      });

      expect(result.query).toContain("@live");
    });

    it("should generate live queries from query functions", () => {
      const result = buildLiveQueryFromFunction((db) =>
        db.user.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
        }),
      );

      expect(result.query).toContain("@live");
    });

    it("should generate live queries for all operations", () => {
      const operations = ["findMany", "findUnique", "findFirst"] as const;

      operations.forEach((operation) => {
        const args =
          operation === "findUnique"
            ? { where: { id: "1" } }
            : { where: { isActive: true } };

        const result = buildQuery("user", operation, args, { isLive: true });

        expect(result.query).toContain("@live");
        expect(result.query).toContain(`query ${operation}User`);
      });
    });

    it("should place @live directive in correct position", () => {
      const result = buildLiveQuery("user", "findMany", {
        where: { name: { contains: "John" } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      // @live should be after arguments but before opening brace
      expect(result.query).toMatch(/users\([^)]*\)\s*@live\s*\{/);
    });

    it("should work with complex nested queries", () => {
      const result = buildLiveQuery("user", "findMany", {
        where: {
          AND: [{ isActive: true }, { posts: { some: { published: true } } }],
        },
        include: {
          posts: {
            where: { published: true },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          profile: true,
        },
      });

      expect(result.query).toContain("@live");
      expect(result.query).toContain("posts(");
      expect(result.query).toContain("profile {");
    });
  });

  describe("Query Builder Configuration", () => {
    it("should respect enableLiveQueries option", () => {
      const builder = new QueryBuilder({ enableLiveQueries: true });

      const result = builder.build("user", "findMany", {
        where: { isActive: true },
      });

      expect(result.query).toContain("@live");
    });

    it("should respect forceLiveQueries option", () => {
      const builder = new QueryBuilder({ forceLiveQueries: true });

      const result = builder.build(
        "user",
        "findMany",
        {
          where: { isActive: true },
        },
        { isLive: false },
      ); // Explicit false should be overridden

      expect(result.query).toContain("@live");
    });

    it("should allow explicit override when enableLiveQueries is true", () => {
      const builder = new QueryBuilder({ enableLiveQueries: true });

      const result = builder.build(
        "user",
        "findMany",
        {
          where: { isActive: true },
        },
        { isLive: false },
      );

      expect(result.query).not.toContain("@live");
    });

    it("should not override forceLiveQueries with explicit false", () => {
      const builder = new QueryBuilder({ forceLiveQueries: true });

      const result = builder.build(
        "user",
        "findMany",
        {
          where: { isActive: true },
        },
        { isLive: false },
      );

      // forceLiveQueries should take precedence
      expect(result.query).toContain("@live");
    });
  });

  describe("Live Query Utility Functions", () => {
    it("should create live query from regular query", () => {
      const regularQuery = "query GetUsers { users { id name } }";
      const liveQuery = createLiveQuery(regularQuery);

      expect(liveQuery).toContain("@live");
      expect(liveQuery).toBe("query GetUsers @live { users { id name } }");
    });

    it("should not duplicate @live directive", () => {
      const alreadyLiveQuery = "query GetUsers @live { users { id name } }";
      const result = createLiveQuery(alreadyLiveQuery);

      expect(result).toBe(alreadyLiveQuery);
      expect((result.match(/@live/g) || []).length).toBe(1);
    });

    it("should create regular query when isLive is false", () => {
      const regularQuery = "query GetUsers { users { id name } }";
      const result = createLiveQuery(regularQuery, { isLive: false });

      expect(result).toBe(regularQuery);
      expect(result).not.toContain("@live");
    });

    it("should detect live queries correctly", () => {
      const liveQuery = "query GetUsers @live { users { id name } }";
      const regularQuery = "query GetUsers { users { id name } }";

      expect(isLiveQuery(liveQuery)).toBe(true);
      expect(isLiveQuery(regularQuery)).toBe(false);
    });

    it("should remove live directive", () => {
      const liveQuery = "query GetUsers @live { users { id name } }";
      const regularQuery = removeLiveDirective(liveQuery);

      expect(regularQuery).toBe("query GetUsers { users { id name } }");
      expect(regularQuery).not.toContain("@live");
    });

    it("should handle multiple @live directives", () => {
      const queryWithMultipleLive =
        "query GetUsers @live { users @live { id name } }";
      const cleaned = removeLiveDirective(queryWithMultipleLive);

      expect(cleaned).toBe("query GetUsers { users { id name } }");
      expect(cleaned).not.toContain("@live");
    });
  });

  describe("Query Function Capture for Live Queries", () => {
    it("should capture and convert simple queries", () => {
      const result = buildQueryFromFunction(
        (db) => db.user.findMany({ where: { isActive: true } }),
        { isLive: true },
      );

      expect(result.query).toContain("@live");
      expect(result.query).toContain("users");
      expect(result.variables).toBeDefined();
    });

    it("should capture complex nested queries", () => {
      const result = buildLiveQueryFromFunction((db) =>
        db.user.findMany({
          where: {
            OR: [
              { name: { contains: "John" } },
              { email: { endsWith: "@example.com" } },
            ],
          },
          include: {
            posts: {
              where: { published: true },
              include: {
                comments: {
                  where: { approved: true },
                  take: 10,
                },
              },
            },
          },
          orderBy: [{ createdAt: "desc" }, { name: "asc" }],
          take: 20,
          skip: 10,
        }),
      );

      expect(result.query).toContain("@live");
      expect(result.query).toContain("posts(");
      expect(result.query).toContain("comments(");
      expect(result.variables).toBeDefined();
    });

    it("should handle different query operations in live mode", () => {
      const findUniqueResult = buildLiveQueryFromFunction((db) =>
        db.user.findUnique({ where: { id: "1" } }),
      );

      const findFirstResult = buildLiveQueryFromFunction((db) =>
        db.user.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
        }),
      );

      expect(findUniqueResult.query).toContain("@live");
      expect(findUniqueResult.query).toContain("user(");

      expect(findFirstResult.query).toContain("@live");
      expect(findFirstResult.query).toContain("user(");
    });

    it("should preserve query variables in live queries", () => {
      const result = buildLiveQueryFromFunction((db) =>
        db.user.findMany({
          where: {
            name: { contains: "John" },
            age: { gte: 18 },
            tags: { in: ["developer", "designer"] },
          },
          take: 50,
        }),
      );

      expect(result.query).toContain("@live");
      expect(result.variables).toBeDefined();
      expect(Object.keys(result.variables || {})).toHaveLength(3);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid query functions gracefully", () => {
      expect(() => {
        buildLiveQueryFromFunction(() => {
          // No database query call
          return { invalid: "result" };
        });
      }).toThrow("No query was captured");
    });

    it("should handle malformed queries in createLiveQuery", () => {
      const malformedQuery = "not a valid graphql query";
      const result = createLiveQuery(malformedQuery);

      // Should still try to add @live directive (but won't match GraphQL structure)
      expect(result).toBe(malformedQuery);
    });
  });

  describe("Integration with Variables", () => {
    it("should maintain variable references in live queries", () => {
      const result = buildLiveQuery("user", "findMany", {
        where: {
          AND: [
            { name: { contains: "John" } },
            { age: { gte: 25 } },
            { city: { in: ["New York", "San Francisco"] } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      expect(result.query).toContain("@live");
      expect(result.variables).toBeDefined();
      expect(Object.values(result.variables || {})).toContain("John");
      expect(Object.values(result.variables || {})).toContain(25);
      expect(
        Object.values(result.variables || {}).some(
          (v) => Array.isArray(v) && v.includes("New York"),
        ),
      ).toBe(true);
    });

    it("should handle empty variables in live queries", () => {
      const result = buildLiveQuery("user", "findMany", {
        select: { id: true, name: true },
      });

      expect(result.query).toContain("@live");
      expect(result.variables).toBeUndefined();
    });
  });

  describe("Query Formatting and Structure", () => {
    it("should maintain proper GraphQL query structure with @live", () => {
      const result = buildLiveQuery("user", "findMany", {
        where: { isActive: true },
        select: { id: true, name: true, email: true },
      });

      const expectedPattern =
        /query findManyUser\([^)]*\) \{\s*users[^{]*@live[^{]*\{\s*id\s*name\s*email\s*\}\s*\}/;
      expect(result.query.replace(/\s+/g, " ")).toMatch(
        /query findManyUser.*users.*@live.*\{.*id.*name.*email.*\}/,
      );
    });

    it("should handle queries with no arguments", () => {
      const result = buildLiveQuery("user", "findMany", {
        select: { id: true, name: true },
      });

      expect(result.query).toContain("@live");
      expect(result.query).toMatch(/users\s*@live\s*\{/);
    });

    it("should format complex nested structures properly", () => {
      const result = buildLiveQuery("user", "findMany", {
        include: {
          posts: {
            include: {
              comments: {
                include: {
                  author: true,
                },
              },
            },
          },
          profile: {
            select: {
              bio: true,
              avatar: true,
            },
          },
        },
      });

      expect(result.query).toContain("@live");
      expect(result.query).toContain("posts {");
      expect(result.query).toContain("comments {");
      expect(result.query).toContain("author {");
      expect(result.query).toContain("profile {");
      expect(result.query).toContain("bio");
      expect(result.query).toContain("avatar");
    });
  });
});
