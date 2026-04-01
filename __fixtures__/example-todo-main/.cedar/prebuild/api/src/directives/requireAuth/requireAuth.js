import { createValidatorDirective } from '@cedarjs/graphql-server';
import { requireAuth as applicationRequireAuth } from "../../lib/auth";
export const schema = {
  "kind": "Document",
  "definitions": [{
    "kind": "DirectiveDefinition",
    "name": {
      "kind": "Name",
      "value": "requireAuth"
    },
    "arguments": [{
      "kind": "InputValueDefinition",
      "name": {
        "kind": "Name",
        "value": "roles"
      },
      "type": {
        "kind": "ListType",
        "type": {
          "kind": "NamedType",
          "name": {
            "kind": "Name",
            "value": "String"
          }
        }
      },
      "directives": []
    }],
    "repeatable": false,
    "locations": [{
      "kind": "Name",
      "value": "FIELD_DEFINITION"
    }]
  }],
  "loc": {
    "start": 0,
    "end": 63,
    "source": {
      "body": "\n  directive @requireAuth(roles: [String]) on FIELD_DEFINITION\n",
      "name": "GraphQL request",
      "locationOffset": {
        "line": 1,
        "column": 1
      }
    }
  }
};
const validate = ({
  directiveArgs
}) => {
  const {
    roles
  } = directiveArgs;
  applicationRequireAuth({
    roles
  });
};
const requireAuth = createValidatorDirective(schema, validate);
export default requireAuth;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmVhdGVWYWxpZGF0b3JEaXJlY3RpdmUiLCJyZXF1aXJlQXV0aCIsImFwcGxpY2F0aW9uUmVxdWlyZUF1dGgiLCJzY2hlbWEiLCJ2YWxpZGF0ZSIsImRpcmVjdGl2ZUFyZ3MiLCJyb2xlcyJdLCJzb3VyY2VzIjpbInJlcXVpcmVBdXRoLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBncWwgZnJvbSAnZ3JhcGhxbC10YWcnXG5cbmltcG9ydCB7IGNyZWF0ZVZhbGlkYXRvckRpcmVjdGl2ZSB9IGZyb20gJ0BjZWRhcmpzL2dyYXBocWwtc2VydmVyJ1xuXG5pbXBvcnQgeyByZXF1aXJlQXV0aCBhcyBhcHBsaWNhdGlvblJlcXVpcmVBdXRoIH0gZnJvbSAnc3JjL2xpYi9hdXRoJ1xuXG5leHBvcnQgY29uc3Qgc2NoZW1hID0gZ3FsYFxuICBkaXJlY3RpdmUgQHJlcXVpcmVBdXRoKHJvbGVzOiBbU3RyaW5nXSkgb24gRklFTERfREVGSU5JVElPTlxuYFxuXG5jb25zdCB2YWxpZGF0ZSA9ICh7IGRpcmVjdGl2ZUFyZ3MgfSkgPT4ge1xuICBjb25zdCB7IHJvbGVzIH0gPSBkaXJlY3RpdmVBcmdzXG4gIGFwcGxpY2F0aW9uUmVxdWlyZUF1dGgoeyByb2xlcyB9KVxufVxuXG5jb25zdCByZXF1aXJlQXV0aCA9IGNyZWF0ZVZhbGlkYXRvckRpcmVjdGl2ZShzY2hlbWEsIHZhbGlkYXRlKVxuXG5leHBvcnQgZGVmYXVsdCByZXF1aXJlQXV0aFxuIl0sIm1hcHBpbmdzIjoiQUFFQSxTQUFTQSx3QkFBd0IsUUFBUSx5QkFBeUI7QUFFbEUsU0FBU0MsV0FBVyxJQUFJQyxzQkFBc0I7QUFFOUMsT0FBTyxNQUFNQyxNQUFNO0VBQUE7RUFBQTtJQUFBO0lBQUE7TUFBQTtNQUFBO0lBQUE7SUFBQTtNQUFBO01BQUE7UUFBQTtRQUFBO01BQUE7TUFBQTtRQUFBO1FBQUE7VUFBQTtVQUFBO1lBQUE7WUFBQTtVQUFBO1FBQUE7TUFBQTtNQUFBO0lBQUE7SUFBQTtJQUFBO01BQUE7TUFBQTtJQUFBO0VBQUE7RUFBQTtJQUFBO0lBQUE7SUFBQTtNQUFBO01BQUE7TUFBQTtRQUFBO1FBQUE7TUFBQTtJQUFBO0VBQUE7QUFBQSxDQUVsQjtBQUVELE1BQU1DLFFBQVEsR0FBR0EsQ0FBQztFQUFFQztBQUFjLENBQUMsS0FBSztFQUN0QyxNQUFNO0lBQUVDO0VBQU0sQ0FBQyxHQUFHRCxhQUFhO0VBQy9CSCxzQkFBc0IsQ0FBQztJQUFFSTtFQUFNLENBQUMsQ0FBQztBQUNuQyxDQUFDO0FBRUQsTUFBTUwsV0FBVyxHQUFHRCx3QkFBd0IsQ0FBQ0csTUFBTSxFQUFFQyxRQUFRLENBQUM7QUFFOUQsZUFBZUgsV0FBVyIsImlnbm9yZUxpc3QiOltdfQ==