/**
 * Tests for GraphQLGenerator functionality
 * Verifies that AST is correctly converted to GraphQL query strings
 */

import { describe, beforeEach, test, expect } from "vitest";

import {
  GraphQLGenerator,
  GraphQLGenerateError,
} from "../src/generator/graphql-generator.js";
import {
  QueryAST,
  QueryArgsAST,
  WhereAST,
  SelectAST,
  IncludeAST,
  OrderByAST,
  FieldCondition,
  LogicalCondition,
  RelationCondition,
  FieldSelection,
  RelationInclusion,
  OrderByField,
} from "../src/types/ast.js";

describe("GraphQLGenerator", () => {
  let generator: GraphQLGenerator;

  beforeEach(() => {
    generator = new GraphQLGenerator();
  });

  describe("Basic Query Generation", () => {
    test("should generate simple findMany query", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("query findManyUser");
      expect(result.query).toContain("users {");
      expect(result.query).toContain("id");
      expect(result.variables).toBeUndefined();
    });

    test("should generate findUnique query", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findUnique",
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("query findUniqueUser");
      expect(result.query).toContain("user {");
    });

    test("should generate findFirst query", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "post",
        operation: "findFirst",
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("query findFirstPost");
      expect(result.query).toContain("post {");
    });
  });

  describe("Where Clause Generation", () => {
    test("should generate simple equality condition", () => {
      const whereAST: WhereAST = {
        type: "Where",
        conditions: [
          {
            type: "FieldCondition",
            field: "isActive",
            operator: "equals",
            value: true,
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: whereAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("where: { isActive: $var0 }");
      expect(result.variables).toEqual({ var0: true });
      expect(result.query).toContain("$var0: Boolean");
    });

    test("should generate filter conditions", () => {
      const whereAST: WhereAST = {
        type: "Where",
        conditions: [
          {
            type: "FieldCondition",
            field: "name",
            operator: "contains",
            value: "john",
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: whereAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("name: { contains: $var0 }");
      expect(result.variables).toEqual({ var0: "john" });
    });

    test("should generate multiple conditions with AND", () => {
      const whereAST: WhereAST = {
        type: "Where",
        conditions: [
          {
            type: "FieldCondition",
            field: "isActive",
            operator: "equals",
            value: true,
          },
          {
            type: "FieldCondition",
            field: "name",
            operator: "contains",
            value: "john",
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: whereAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("AND:");
      expect(result.variables).toEqual({ var0: true, var1: "john" });
    });

    test("should generate OR conditions", () => {
      const logicalCondition: LogicalCondition = {
        type: "LogicalCondition",
        operator: "OR",
        conditions: [
          {
            type: "FieldCondition",
            field: "email",
            operator: "equals",
            value: "john@example.com",
          },
          {
            type: "FieldCondition",
            field: "name",
            operator: "equals",
            value: "John Doe",
          },
        ],
      };

      const whereAST: WhereAST = {
        type: "Where",
        conditions: [logicalCondition],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: whereAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("OR:");
      expect(result.variables).toEqual({
        var0: "john@example.com",
        var1: "John Doe",
      });
    });

    test("should generate NOT conditions", () => {
      const logicalCondition: LogicalCondition = {
        type: "LogicalCondition",
        operator: "NOT",
        conditions: [
          {
            type: "FieldCondition",
            field: "isActive",
            operator: "equals",
            value: false,
          },
        ],
      };

      const whereAST: WhereAST = {
        type: "Where",
        conditions: [logicalCondition],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: whereAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("NOT:");
      expect(result.variables).toEqual({ var0: false });
    });

    test("should handle various operators", () => {
      const testCases = [
        { operator: "gt" as const, value: 10, expectedGraphQL: "gt" },
        { operator: "gte" as const, value: 5, expectedGraphQL: "gte" },
        { operator: "lt" as const, value: 100, expectedGraphQL: "lt" },
        { operator: "lte" as const, value: 50, expectedGraphQL: "lte" },
        { operator: "in" as const, value: [1, 2, 3], expectedGraphQL: "in" },
        {
          operator: "notIn" as const,
          value: [4, 5, 6],
          expectedGraphQL: "notIn",
        },
        {
          operator: "startsWith" as const,
          value: "prefix",
          expectedGraphQL: "startsWith",
        },
        {
          operator: "endsWith" as const,
          value: "suffix",
          expectedGraphQL: "endsWith",
        },
      ];

      testCases.forEach(({ operator, value, expectedGraphQL }) => {
        const whereAST: WhereAST = {
          type: "Where",
          conditions: [
            {
              type: "FieldCondition",
              field: "testField",
              operator,
              value,
            },
          ],
        };

        const ast: QueryAST = {
          type: "Query",
          model: "user",
          operation: "findMany",
          args: {
            type: "QueryArgs",
            where: whereAST,
          },
        };

        const result = generator.generate(ast);

        expect(result.query).toContain(`${expectedGraphQL}:`);
        expect(result.variables?.var0).toEqual(value);
      });
    });

    test("should handle null operators", () => {
      const whereAST: WhereAST = {
        type: "Where",
        conditions: [
          {
            type: "FieldCondition",
            field: "name",
            operator: "isNull",
            value: null,
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: whereAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("isNull: true");
    });
  });

  describe("Select Clause Generation", () => {
    test("should generate selected fields", () => {
      const selectAST: SelectAST = {
        type: "Select",
        fields: [
          {
            type: "FieldSelection",
            field: "id",
            selected: true,
          },
          {
            type: "FieldSelection",
            field: "name",
            selected: true,
          },
          {
            type: "FieldSelection",
            field: "email",
            selected: false,
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          select: selectAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("id");
      expect(result.query).toContain("name");
      expect(result.query).not.toContain("email");
    });

    test("should generate nested field selection", () => {
      const nestedSelect: SelectAST = {
        type: "Select",
        fields: [
          {
            type: "FieldSelection",
            field: "title",
            selected: true,
          },
        ],
      };

      const selectAST: SelectAST = {
        type: "Select",
        fields: [
          {
            type: "FieldSelection",
            field: "id",
            selected: true,
          },
          {
            type: "FieldSelection",
            field: "posts",
            selected: true,
            nested: nestedSelect,
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          select: selectAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("id");
      expect(result.query).toContain("posts {");
      expect(result.query).toContain("title");
    });
  });

  describe("Include Clause Generation", () => {
    test("should generate basic includes", () => {
      const includeAST: IncludeAST = {
        type: "Include",
        relations: [
          {
            type: "RelationInclusion",
            relation: "posts",
            included: true,
          },
          {
            type: "RelationInclusion",
            relation: "profile",
            included: false,
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          include: includeAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("posts {");
      expect(result.query).not.toContain("profile {");
    });

    test("should generate includes with arguments", () => {
      const relationArgs: QueryArgsAST = {
        type: "QueryArgs",
        where: {
          type: "Where",
          conditions: [
            {
              type: "FieldCondition",
              field: "published",
              operator: "equals",
              value: true,
            },
          ],
        },
        take: 5,
      };

      const includeAST: IncludeAST = {
        type: "Include",
        relations: [
          {
            type: "RelationInclusion",
            relation: "posts",
            included: true,
            args: relationArgs,
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          include: includeAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain(
        "posts(where: { published: $var0 }, first: 5)",
      );
      expect(result.variables).toEqual({ var0: true });
    });

    test("should generate nested includes", () => {
      const nestedInclude: IncludeAST = {
        type: "Include",
        relations: [
          {
            type: "RelationInclusion",
            relation: "comments",
            included: true,
          },
        ],
      };

      const includeAST: IncludeAST = {
        type: "Include",
        relations: [
          {
            type: "RelationInclusion",
            relation: "posts",
            included: true,
            nested: nestedInclude,
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          include: includeAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("posts {");
      expect(result.query).toContain("comments {");
    });
  });

  describe("OrderBy Generation", () => {
    test("should generate single field ordering", () => {
      const orderByAST: OrderByAST = {
        type: "OrderBy",
        fields: [
          {
            type: "OrderByField",
            field: "createdAt",
            direction: "desc",
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          orderBy: orderByAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("orderBy: { createdAt: DESC }");
    });

    test("should generate multiple field ordering", () => {
      const orderByAST: OrderByAST = {
        type: "OrderBy",
        fields: [
          {
            type: "OrderByField",
            field: "name",
            direction: "asc",
          },
          {
            type: "OrderByField",
            field: "createdAt",
            direction: "desc",
          },
        ],
      };

      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          orderBy: orderByAST,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain(
        "orderBy: [{ name: ASC }, { createdAt: DESC }]",
      );
    });
  });

  describe("Pagination Generation", () => {
    test("should generate take parameter as first", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          take: 10,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("first: 10");
    });

    test("should generate skip parameter", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          skip: 5,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("skip: 5");
    });

    test("should generate both take and skip", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          take: 10,
          skip: 20,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("first: 10");
      expect(result.query).toContain("skip: 20");
    });
  });

  describe("Variable Type Detection", () => {
    test("should detect string types", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: {
            type: "Where",
            conditions: [
              {
                type: "FieldCondition",
                field: "name",
                operator: "equals",
                value: "John",
              },
            ],
          },
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("$var0: String");
    });

    test("should detect number types", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: {
            type: "Where",
            conditions: [
              {
                type: "FieldCondition",
                field: "age",
                operator: "equals",
                value: 25,
              },
              {
                type: "FieldCondition",
                field: "score",
                operator: "equals",
                value: 95.5,
              },
            ],
          },
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("$var0: Int");
      expect(result.query).toContain("$var1: Float");
    });

    test("should detect boolean types", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: {
            type: "Where",
            conditions: [
              {
                type: "FieldCondition",
                field: "isActive",
                operator: "equals",
                value: true,
              },
            ],
          },
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("$var0: Boolean");
    });

    test("should detect array types", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: {
            type: "Where",
            conditions: [
              {
                type: "FieldCondition",
                field: "id",
                operator: "in",
                value: [1, 2, 3],
              },
            ],
          },
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("$var0: [ID!]");
    });
  });

  describe("Complex Queries", () => {
    test("should generate complex query with all features", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: {
            type: "Where",
            conditions: [
              {
                type: "FieldCondition",
                field: "isActive",
                operator: "equals",
                value: true,
              },
              {
                type: "LogicalCondition",
                operator: "OR",
                conditions: [
                  {
                    type: "FieldCondition",
                    field: "name",
                    operator: "contains",
                    value: "john",
                  },
                  {
                    type: "FieldCondition",
                    field: "email",
                    operator: "contains",
                    value: "john",
                  },
                ],
              },
            ],
          },
          select: {
            type: "Select",
            fields: [
              {
                type: "FieldSelection",
                field: "id",
                selected: true,
              },
              {
                type: "FieldSelection",
                field: "name",
                selected: true,
              },
            ],
          },
          orderBy: {
            type: "OrderBy",
            fields: [
              {
                type: "OrderByField",
                field: "createdAt",
                direction: "desc",
              },
            ],
          },
          take: 10,
          skip: 5,
        },
      };

      const result = generator.generate(ast);

      expect(result.query).toContain("query findManyUser");
      expect(result.query).toContain("where:");
      expect(result.query).toContain("orderBy:");
      expect(result.query).toContain("first: 10");
      expect(result.query).toContain("skip: 5");
      expect(result.query).toContain("id");
      expect(result.query).toContain("name");
      expect(result.variables).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    test("should throw error for unsupported operation", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "unsupported" as any,
      };

      expect(() => {
        generator.generate(ast);
      }).toThrow(GraphQLGenerateError);
    });

    test("should throw error for NOT with multiple conditions", () => {
      const ast: QueryAST = {
        type: "Query",
        model: "user",
        operation: "findMany",
        args: {
          type: "QueryArgs",
          where: {
            type: "Where",
            conditions: [
              {
                type: "LogicalCondition",
                operator: "NOT",
                conditions: [
                  {
                    type: "FieldCondition",
                    field: "field1",
                    operator: "equals",
                    value: "value1",
                  },
                  {
                    type: "FieldCondition",
                    field: "field2",
                    operator: "equals",
                    value: "value2",
                  },
                ],
              },
            ],
          },
        },
      };

      expect(() => {
        generator.generate(ast);
      }).toThrow(GraphQLGenerateError);
    });
  });
});
