import { describe, test, beforeEach, expect } from "vitest";
/**
 * Tests for QueryParser functionality
 * Verifies that ORM queries are correctly parsed into AST representation
 */

import { QueryParser, QueryParseError } from "../src/parser/query-parser.js";
import {
  QueryAST,
  isQueryAST,
  isWhereAST,
  isSelectAST,
  isIncludeAST,
  isFieldCondition,
  isLogicalCondition,
} from "../src/types/ast.js";
import {
  FindManyArgs,
  User,
  UserFindManyArgs,
  UserFindUniqueArgs,
} from "../src/types/orm.js";

describe("QueryParser", () => {
  let parser: QueryParser;

  beforeEach(() => {
    parser = new QueryParser();
  });

  describe("Basic Query Parsing", () => {
    test("should parse simple findMany query", () => {
      const ast = parser.parseQuery("user", "findMany");

      expect(isQueryAST(ast)).toBe(true);
      expect(ast.model).toBe("user");
      expect(ast.operation).toBe("findMany");
      expect(ast.args).toBeUndefined();
    });

    test("should parse findUnique query", () => {
      const args: UserFindUniqueArgs = {
        where: { id: 1 },
      };

      const ast = parser.parseQuery("user", "findUnique", args);

      expect(ast.model).toBe("user");
      expect(ast.operation).toBe("findUnique");
      expect(ast.args).toBeDefined();
      expect(ast.args?.where).toBeDefined();
    });

    test("should parse findFirst query", () => {
      const args: FindManyArgs<User> = {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      };

      const ast = parser.parseQuery("user", "findFirst", args);

      expect(ast.model).toBe("user");
      expect(ast.operation).toBe("findFirst");
      expect(ast.args?.where).toBeDefined();
      expect(ast.args?.orderBy).toBeDefined();
    });
  });

  describe("Where Clause Parsing", () => {
    test("should parse simple equality condition", () => {
      const args: UserFindManyArgs = {
        where: { isActive: true },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const whereAST = ast.args?.where;

      expect(isWhereAST(whereAST!)).toBe(true);
      expect(whereAST?.conditions).toHaveLength(1);

      const condition = whereAST?.conditions[0];
      expect(isFieldCondition(condition!)).toBe(true);

      if (isFieldCondition(condition!)) {
        expect(condition.field).toBe("isActive");
        expect(condition.operator).toBe("equals");
        expect(condition.value).toBe(true);
      }
    });

    test("should parse filter objects", () => {
      const args: UserFindManyArgs = {
        where: {
          name: { contains: "john" },
          id: { gt: 10 },
        },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const conditions = ast.args?.where?.conditions;

      expect(conditions).toHaveLength(2);

      const nameCondition = conditions?.find(
        (c) => isFieldCondition(c) && c.field === "name",
      );
      const idCondition = conditions?.find(
        (c) => isFieldCondition(c) && c.field === "id",
      );

      expect(nameCondition).toBeDefined();
      expect(idCondition).toBeDefined();

      if (isFieldCondition(nameCondition!)) {
        expect(nameCondition.operator).toBe("contains");
        expect(nameCondition.value).toBe("john");
      }

      if (isFieldCondition(idCondition!)) {
        expect(idCondition.operator).toBe("gt");
        expect(idCondition.value).toBe(10);
      }
    });

    test("should parse logical operators", () => {
      const args: UserFindManyArgs = {
        where: {
          AND: [{ isActive: true }, { name: { contains: "john" } }],
        },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const conditions = ast.args?.where?.conditions;

      expect(conditions).toHaveLength(1);

      const logicalCondition = conditions?.[0];
      expect(isLogicalCondition(logicalCondition!)).toBe(true);

      if (isLogicalCondition(logicalCondition!)) {
        expect(logicalCondition.operator).toBe("AND");
        expect(logicalCondition.conditions).toHaveLength(2);
      }
    });

    test("should parse OR conditions", () => {
      const args: UserFindManyArgs = {
        where: {
          OR: [{ email: "john@example.com" }, { name: "John Doe" }],
        },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const condition = ast.args?.where?.conditions[0];

      expect(isLogicalCondition(condition!)).toBe(true);

      if (isLogicalCondition(condition!)) {
        expect(condition.operator).toBe("OR");
        expect(condition.conditions).toHaveLength(2);
      }
    });

    test("should parse NOT conditions", () => {
      const args: UserFindManyArgs = {
        where: {
          NOT: { isActive: false },
        },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const condition = ast.args?.where?.conditions[0];

      expect(isLogicalCondition(condition!)).toBe(true);

      if (isLogicalCondition(condition!)) {
        expect(condition.operator).toBe("NOT");
        expect(condition.conditions).toHaveLength(1);
      }
    });
  });

  describe("Select Clause Parsing", () => {
    test("should parse simple select fields", () => {
      const args: UserFindManyArgs = {
        select: {
          id: true,
          name: true,
          email: false,
        },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const selectAST = ast.args?.select;

      expect(isSelectAST(selectAST!)).toBe(true);
      expect(selectAST?.fields).toHaveLength(3);

      const idField = selectAST?.fields.find((f) => f.field === "id");
      const nameField = selectAST?.fields.find((f) => f.field === "name");
      const emailField = selectAST?.fields.find((f) => f.field === "email");

      expect(idField?.selected).toBe(true);
      expect(nameField?.selected).toBe(true);
      expect(emailField?.selected).toBe(false);
    });
  });

  describe("Include Clause Parsing", () => {
    test("should parse simple includes", () => {
      const args: UserFindManyArgs = {
        include: {
          posts: true,
          profile: false,
        },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const includeAST = ast.args?.include;

      expect(isIncludeAST(includeAST!)).toBe(true);
      expect(includeAST?.relations).toHaveLength(2);

      const postsRelation = includeAST?.relations.find(
        (r) => r.relation === "posts",
      );
      const profileRelation = includeAST?.relations.find(
        (r) => r.relation === "profile",
      );

      expect(postsRelation?.included).toBe(true);
      expect(profileRelation?.included).toBe(false);
    });

    test("should parse nested includes with arguments", () => {
      const args: UserFindManyArgs = {
        include: {
          posts: {
            where: { published: true },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const includeAST = ast.args?.include;
      const postsRelation = includeAST?.relations.find(
        (r) => r.relation === "posts",
      );

      expect(postsRelation?.included).toBe(true);
      expect(postsRelation?.args).toBeDefined();
      expect(postsRelation?.args?.where).toBeDefined();
      expect(postsRelation?.args?.orderBy).toBeDefined();
      expect(postsRelation?.args?.take).toBe(10);
    });
  });

  describe("OrderBy Clause Parsing", () => {
    test("should parse single field ordering", () => {
      const args: UserFindManyArgs = {
        orderBy: { createdAt: "desc" },
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const orderByAST = ast.args?.orderBy;

      expect(orderByAST?.fields).toHaveLength(1);
      expect(orderByAST?.fields[0]?.field).toBe("createdAt");
      expect(orderByAST?.fields[0]?.direction).toBe("desc");
    });

    test("should parse multiple field ordering", () => {
      const args: UserFindManyArgs = {
        orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      };

      const ast = parser.parseQuery("user", "findMany", args);
      const orderByAST = ast.args?.orderBy;

      expect(orderByAST?.fields).toHaveLength(2);
      expect(orderByAST?.fields[0]?.field).toBe("name");
      expect(orderByAST?.fields[0]?.direction).toBe("asc");
      expect(orderByAST?.fields[1]?.field).toBe("createdAt");
      expect(orderByAST?.fields[1]?.direction).toBe("desc");
    });
  });

  describe("Pagination Parsing", () => {
    test("should parse take and skip parameters", () => {
      const args: UserFindManyArgs = {
        take: 10,
        skip: 5,
      };

      const ast = parser.parseQuery("user", "findMany", args);

      expect(ast.args?.take).toBe(10);
      expect(ast.args?.skip).toBe(5);
    });
  });

  describe("Error Handling", () => {
    test("should throw error for missing model", () => {
      expect(() => {
        parser.parseQuery("", "findMany");
      }).toThrow(QueryParseError);
    });

    test("should throw error for missing operation", () => {
      expect(() => {
        // @ts-expect-error - testing invalid code on purpose
        parser.parseQuery("user", "");
      }).toThrow(QueryParseError);
    });

    test("should throw error for invalid sort direction", () => {
      const args = {
        orderBy: { name: "invalid" },
      };

      expect(() => {
        // @ts-expect-error - testing invalid code on purpose
        parser.parseQuery("user", "findMany", args);
      }).toThrow(QueryParseError);
    });

    test("should throw error for invalid comparison operator", () => {
      const argsWithInvalidFilter = {
        where: {
          // Multiple operators, one invalid
          name: { contains: "test", invalidOp: "bad" },
        },
      };

      expect(() => {
        parser.parseQuery("user", "findMany", argsWithInvalidFilter);
      }).toThrow(QueryParseError);
    });
  });

  describe("Validation", () => {
    test("should validate findUnique requires where clause", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findUnique",
        // Missing args.where
      };

      expect(() => {
        parser.validateAST(ast);
      }).toThrow(QueryParseError);
    });

    test("should validate findUniqueOrThrow requires where clause", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findUniqueOrThrow",
        // Missing args.where
      };

      expect(() => {
        parser.validateAST(ast);
      }).toThrow(QueryParseError);
    });

    test("should pass validation for valid AST", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: {
            type: "Where",
            conditions: [],
          },
        },
      };

      expect(() => {
        parser.validateAST(ast);
      }).not.toThrow();
    });
  });
});
