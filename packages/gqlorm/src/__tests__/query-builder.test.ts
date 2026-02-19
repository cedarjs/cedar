/**
 * Integration tests for the complete QueryBuilder functionality
 * Tests the end-to-end flow from ORM queries to GraphQL generation
 */

import { describe, beforeEach, test, expect } from "vitest";

import {
  QueryBuilder,
  QueryBuilderError,
  buildQuery,
  buildQueryFromFunction,
} from "../src/query-builder.js";
import {
  FindManyArgs,
  User,
  UserFindManyArgs,
  UserFindUniqueArgs,
  QueryFunction,
} from "../src/types/orm.js";

describe("QueryBuilder Integration Tests", () => {
  let queryBuilder: QueryBuilder;

  beforeEach(() => {
    queryBuilder = new QueryBuilder();
  });

  describe("Basic Query Building", () => {
    test("should build simple findMany query", () => {
      const result = queryBuilder.build("user", "findMany");

      expect(result.query).toContain("query findManyUser");
      expect(result.query).toContain("users {");
      expect(result.query).toContain("id");
      expect(result.variables).toBeUndefined();
    });

    test("should build findUnique query with where clause", () => {
      const args: UserFindUniqueArgs = {
        where: { id: 1 },
      };

      const result = queryBuilder.build("user", "findUnique", args);

      expect(result.query).toContain("query findUniqueUser");
      expect(result.query).toContain("user(id: $var0)");
      expect(result.variables).toEqual({ var0: 1 });
    });

    test("should build findFirst query with ordering", () => {
      const args: UserFindManyArgs = {
        orderBy: { createdAt: "desc" },
        take: 1,
      };

      const result = queryBuilder.build("user", "findFirst", args);

      expect(result.query).toContain("query findFirstUser");
      expect(result.query).toContain("orderBy: { createdAt: DESC }");
      expect(result.query).toContain("first: 1");
    });
  });

  describe("Complex Where Conditions", () => {
    test("should build query with multiple where conditions", () => {
      const args: UserFindManyArgs = {
        where: {
          isActive: true,
          name: { contains: "john" },
          id: { gt: 10 },
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("where: { AND:");
      expect(result.query).toContain("isActive: $var0");
      expect(result.query).toContain("name: { contains: $var1 }");
      expect(result.query).toContain("id: { gt: $var2 }");
      expect(result.variables).toEqual({
        var0: true,
        var1: "john",
        var2: 10,
      });
    });

    test("should build query with OR conditions", () => {
      const args: UserFindManyArgs = {
        where: {
          OR: [{ email: "john@example.com" }, { name: "John Doe" }],
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("where: { OR:");
      expect(result.variables).toEqual({
        var0: "john@example.com",
        var1: "John Doe",
      });
    });

    test("should build query with nested logical conditions", () => {
      const args: UserFindManyArgs = {
        where: {
          AND: [
            { isActive: true },
            {
              OR: [
                { name: { contains: "admin" } },
                { email: { contains: "admin" } },
              ],
            },
          ],
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("AND:");
      expect(result.query).toContain("OR:");
      expect(result.variables).toEqual({
        var0: true,
        var1: "admin",
        var2: "admin",
      });
    });

    test("should build query with NOT condition", () => {
      const args: UserFindManyArgs = {
        where: {
          NOT: { isActive: false },
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("where: { NOT:");
      expect(result.variables).toEqual({ var0: false });
    });
  });

  describe("Field Selection", () => {
    test("should build query with select fields", () => {
      const args: UserFindManyArgs = {
        select: {
          id: true,
          name: true,
          email: true,
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("id");
      expect(result.query).toContain("name");
      expect(result.query).toContain("email");
    });

    test("should exclude unselected fields", () => {
      const args: UserFindManyArgs = {
        select: {
          id: true,
          name: true,
          email: false,
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("id");
      expect(result.query).toContain("name");
      expect(result.query).not.toContain("email");
    });
  });

  describe("Relation Handling", () => {
    test("should build query with basic includes", () => {
      const args: UserFindManyArgs = {
        include: {
          posts: true,
          profile: true,
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("posts {");
      expect(result.query).toContain("profile {");
    });

    test("should build query with conditional includes", () => {
      const args: UserFindManyArgs = {
        include: {
          posts: {
            where: { published: true },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain(
        "posts(where: { published: $var0 }, orderBy: { createdAt: DESC }, first: 5)",
      );
      expect(result.variables).toEqual({ var0: true });
    });

    test("should build query with nested includes", () => {
      const args: UserFindManyArgs = {
        include: {
          posts: {
            include: {
              comments: true,
            },
          },
        },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("posts {");
      expect(result.query).toContain("comments {");
    });
  });

  describe("Pagination and Sorting", () => {
    test("should build query with pagination", () => {
      const args: UserFindManyArgs = {
        take: 10,
        skip: 20,
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("first: 10");
      expect(result.query).toContain("skip: 20");
    });

    test("should build query with single field ordering", () => {
      const args: UserFindManyArgs = {
        orderBy: { name: "asc" },
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("orderBy: { name: ASC }");
    });

    test("should build query with multiple field ordering", () => {
      const args: UserFindManyArgs = {
        orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain(
        "orderBy: [{ name: ASC }, { createdAt: DESC }]",
      );
    });
  });

  describe("Query Function Capture", () => {
    test("should capture simple query from function", () => {
      const queryFn: QueryFunction<User[]> = (db) => db.user.findMany();

      const result = queryBuilder.buildFromFunction(queryFn);

      expect(result.query).toContain("query findManyUser");
      expect(result.query).toContain("users {");
    });

    test("should capture query with arguments from function", () => {
      const queryFn: QueryFunction<User[]> = (db) =>
        db.user.findMany({
          where: { isActive: true },
          take: 10,
        });

      const result = queryBuilder.buildFromFunction(queryFn);

      expect(result.query).toContain("where: { isActive: $var0 }");
      expect(result.query).toContain("first: 10");
      expect(result.variables).toEqual({ var0: true });
    });

    test("should capture findUnique query from function", () => {
      const queryFn: QueryFunction<User | null> = (db) =>
        db.user.findUnique({
          where: { id: 1 },
          select: { id: true, name: true },
        });

      const result = queryBuilder.buildFromFunction(queryFn);

      expect(result.query).toContain("query findUniqueUser");
      expect(result.query).toContain("user(id: $var0)");
      expect(result.query).toContain("id");
      expect(result.query).toContain("name");
      expect(result.variables).toEqual({ var0: 1 });
    });

    test("should capture complex query from function", () => {
      const queryFn: QueryFunction<User[]> = (db) =>
        db.user.findMany({
          where: {
            AND: [{ isActive: true }, { name: { contains: "admin" } }],
          },
          include: {
            posts: {
              where: { published: true },
              take: 5,
            },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        });

      const result = queryBuilder.buildFromFunction(queryFn);

      expect(result.query).toContain("where: { AND:");
      expect(result.query).toContain(
        "posts(where: { published: $var2 }, first: 5)",
      );
      expect(result.query).toContain("orderBy: { createdAt: DESC }");
      expect(result.query).toContain("first: 20");
      expect(result.variables).toEqual({
        var0: true,
        var1: "admin",
        var2: true,
      });
    });
  });

  describe("Real-world Examples", () => {
    test("should build user dashboard query", () => {
      const args: UserFindManyArgs = {
        where: {
          isActive: true,
          OR: [
            { name: { contains: "admin" } },
            { email: { endsWith: "@company.com" } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      };

      const result = queryBuilder.build("user", "findMany", args);

      expect(result.query).toContain("query findManyUser");
      expect(result.query).toContain(
        "users(where: { AND: [{ isActive: $var0 }, { OR:",
      );
      expect(result.query).toContain("orderBy: { createdAt: DESC }");
      expect(result.query).toContain("first: 50");
      expect(result.variables).toEqual({
        var0: true,
        var1: "admin",
        var2: "@company.com",
      });
    });

    test("should build blog post query with nested relations", () => {
      const args: FindManyArgs<unknown> = {
        where: {
          published: true,
          author: { isActive: true },
        },
        include: {
          author: {
            select: { id: true, name: true },
          },
          comments: {
            where: { approved: true },
            include: {
              author: {
                select: { id: true, name: true },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { publishedAt: "desc" },
        take: 10,
      };

      const result = queryBuilder.build("post", "findMany", args);

      expect(result.query).toContain("query findManyPost");
      expect(result.query).toContain("posts(");
      expect(result.query).toContain("author {");
      expect(result.query).toContain("comments(");
      expect(result.variables).toBeDefined();
    });

    test("should build user profile query", () => {
      const args: UserFindUniqueArgs = {
        where: { id: 123 },
        include: {
          posts: {
            where: { published: true },
            select: {
              id: true,
              title: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
          profile: true,
        },
      };

      const result = queryBuilder.build("user", "findUnique", args);

      expect(result.query).toContain("query findUniqueUser");
      expect(result.query).toContain("user(id: $var0)");
      expect(result.query).toContain("posts(where: { published: $var1 }");
      expect(result.query).toContain("profile {");
      expect(result.variables).toEqual({
        var0: 123,
        var1: true,
      });
    });
  });

  describe("Error Handling", () => {
    test("should throw error for invalid model name", () => {
      expect(() => {
        queryBuilder.build("", "findMany");
      }).toThrow(QueryBuilderError);
    });

    test("should throw error for invalid operation", () => {
      expect(() => {
        // @ts-expect-error - testing invalid input on purpose
        queryBuilder.build("user", "");
      }).toThrow(QueryBuilderError);
    });

    test("should throw error for findUnique without where clause", () => {
      expect(() => {
        queryBuilder.build("user", "findUnique", {});
      }).toThrow(QueryBuilderError);
    });

    test("should throw error for invalid sort direction", () => {
      const args = {
        orderBy: { name: "invalid" },
      };

      expect(() => {
        // @ts-expect-error - testing invalid input on purpose
        queryBuilder.build("user", "findMany", args);
      }).toThrow(QueryBuilderError);
    });

    test("should throw error for query function that does not call any method", () => {
      const queryFn: QueryFunction<unknown> = () => {
        // Do nothing - this should cause an error
        return null;
      };

      expect(() => {
        queryBuilder.buildFromFunction(queryFn);
      }).toThrow(QueryBuilderError);
    });
  });

  describe("Convenience Functions", () => {
    test("buildQuery function should work", () => {
      const result = buildQuery("user", "findMany", {
        where: { isActive: true },
      });

      expect(result.query).toContain("query findManyUser");
      expect(result.variables).toEqual({ var0: true });
    });

    test("buildQueryFromFunction should work", () => {
      const result = buildQueryFromFunction((db) =>
        db.user.findMany({ where: { isActive: true } }),
      );

      expect(result.query).toContain("query findManyUser");
      expect(result.variables).toEqual({ var0: true });
    });
  });

  describe("Options and Configuration", () => {
    test("should create query builder with options", () => {
      const options = {
        validateSchema: true,
        optimizeQueries: false,
      };

      const builder = new QueryBuilder(options);
      const retrievedOptions = builder.getOptions();

      expect(retrievedOptions.validateSchema).toBe(true);
      expect(retrievedOptions.optimizeQueries).toBe(false);
    });

    test("should update query builder options", () => {
      const builder = new QueryBuilder();

      builder.updateOptions({ validateSchema: true });
      const options = builder.getOptions();

      expect(options.validateSchema).toBe(true);
    });
  });

  describe("AST and GraphQL Generation Access", () => {
    test("should expose AST parsing", () => {
      const ast = queryBuilder.parseAST("user", "findMany", {
        where: { isActive: true },
      });

      expect(ast.type).toBe("Query");
      expect(ast.model).toBe("user");
      expect(ast.operation).toBe("findMany");
      expect(ast.args?.where).toBeDefined();
    });

    test("should expose GraphQL generation from AST", () => {
      const ast = queryBuilder.parseAST("user", "findMany", {
        where: { isActive: true },
      });

      const result = queryBuilder.generateGraphQL(ast);

      expect(result.query).toContain("query findManyUser");
      expect(result.variables).toEqual({ var0: true });
    });

    test("should throw error for invalid AST in GraphQL generation", () => {
      const invalidAST = {
        type: "Query",
        model: "user",
        operation: "invalidOperation",
      };

      expect(() => {
        // @ts-expect-error - Testing invalid input on purpose
        queryBuilder.generateGraphQL(invalidAST);
      }).toThrow(QueryBuilderError);
    });
  });

  describe("Type Safety Examples", () => {
    test("should handle various data types correctly", () => {
      const args: FindManyArgs<unknown> = {
        where: {
          stringField: "text",
          numberField: 42,
          floatField: 3.14,
          booleanField: true,
          dateField: new Date("2023-01-01"),
          arrayField: { in: [1, 2, 3] },
        },
      };

      const result = queryBuilder.build("test", "findMany", args);

      expect(result.query).toContain("$var0: String");
      expect(result.query).toContain("$var1: Int");
      expect(result.query).toContain("$var2: Float");
      expect(result.query).toContain("$var3: Boolean");
      expect(result.query).toContain("$var4: DateTime");
      expect(result.query).toContain("$var5: [Int]");

      expect(result.variables).toMatchObject({
        var0: "text",
        var1: 42,
        var2: 3.14,
        var3: true,
        var5: [1, 2, 3],
      });
    });
  });
});
