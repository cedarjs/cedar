import { createValidatorDirective } from '@cedarjs/graphql-server';
export const schema = {
  "kind": "Document",
  "definitions": [{
    "kind": "DirectiveDefinition",
    "name": {
      "kind": "Name",
      "value": "skipAuth"
    },
    "arguments": [],
    "repeatable": false,
    "locations": [{
      "kind": "Name",
      "value": "FIELD_DEFINITION"
    }]
  }],
  "loc": {
    "start": 0,
    "end": 43,
    "source": {
      "body": "\n  directive @skipAuth on FIELD_DEFINITION\n",
      "name": "GraphQL request",
      "locationOffset": {
        "line": 1,
        "column": 1
      }
    }
  }
};
const skipAuth = createValidatorDirective(schema, () => {
  return;
});
export default skipAuth;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmVhdGVWYWxpZGF0b3JEaXJlY3RpdmUiLCJzY2hlbWEiLCJza2lwQXV0aCJdLCJzb3VyY2VzIjpbInNraXBBdXRoLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBncWwgZnJvbSAnZ3JhcGhxbC10YWcnXG5cbmltcG9ydCB7IGNyZWF0ZVZhbGlkYXRvckRpcmVjdGl2ZSB9IGZyb20gJ0BjZWRhcmpzL2dyYXBocWwtc2VydmVyJ1xuXG5leHBvcnQgY29uc3Qgc2NoZW1hID0gZ3FsYFxuICBkaXJlY3RpdmUgQHNraXBBdXRoIG9uIEZJRUxEX0RFRklOSVRJT05cbmBcblxuY29uc3Qgc2tpcEF1dGggPSBjcmVhdGVWYWxpZGF0b3JEaXJlY3RpdmUoc2NoZW1hLCAoKSA9PiB7XG4gIHJldHVyblxufSlcblxuZXhwb3J0IGRlZmF1bHQgc2tpcEF1dGhcbiJdLCJtYXBwaW5ncyI6IkFBRUEsU0FBU0Esd0JBQXdCLFFBQVEseUJBQXlCO0FBRWxFLE9BQU8sTUFBTUMsTUFBTTtFQUFBO0VBQUE7SUFBQTtJQUFBO01BQUE7TUFBQTtJQUFBO0lBQUE7SUFBQTtJQUFBO01BQUE7TUFBQTtJQUFBO0VBQUE7RUFBQTtJQUFBO0lBQUE7SUFBQTtNQUFBO01BQUE7TUFBQTtRQUFBO1FBQUE7TUFBQTtJQUFBO0VBQUE7QUFBQSxDQUVsQjtBQUVELE1BQU1DLFFBQVEsR0FBR0Ysd0JBQXdCLENBQUNDLE1BQU0sRUFBRSxNQUFNO0VBQ3REO0FBQ0YsQ0FBQyxDQUFDO0FBRUYsZUFBZUMsUUFBUSIsImlnbm9yZUxpc3QiOltdfQ==