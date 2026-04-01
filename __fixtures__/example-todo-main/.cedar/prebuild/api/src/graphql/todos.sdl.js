import gql from "graphql-tag";
export const schema = gql`
  type Todo {
    id: Int!
    body: String!
    status: String!
  }

  type Query {
    todos: [Todo] @skipAuth
    todosCount: Int! @skipAuth
  }

  type Mutation {
    createTodo(body: String!): Todo @skipAuth
    updateTodoStatus(id: Int!, status: String!): Todo @skipAuth
    renameTodo(id: Int!, body: String!): Todo @skipAuth
  }
`;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJncWwiLCJzY2hlbWEiXSwic291cmNlcyI6WyJ0b2Rvcy5zZGwuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGNvbnN0IHNjaGVtYSA9IGdxbGBcbiAgdHlwZSBUb2RvIHtcbiAgICBpZDogSW50IVxuICAgIGJvZHk6IFN0cmluZyFcbiAgICBzdGF0dXM6IFN0cmluZyFcbiAgfVxuXG4gIHR5cGUgUXVlcnkge1xuICAgIHRvZG9zOiBbVG9kb10gQHNraXBBdXRoXG4gICAgdG9kb3NDb3VudDogSW50ISBAc2tpcEF1dGhcbiAgfVxuXG4gIHR5cGUgTXV0YXRpb24ge1xuICAgIGNyZWF0ZVRvZG8oYm9keTogU3RyaW5nISk6IFRvZG8gQHNraXBBdXRoXG4gICAgdXBkYXRlVG9kb1N0YXR1cyhpZDogSW50ISwgc3RhdHVzOiBTdHJpbmchKTogVG9kbyBAc2tpcEF1dGhcbiAgICByZW5hbWVUb2RvKGlkOiBJbnQhLCBib2R5OiBTdHJpbmchKTogVG9kbyBAc2tpcEF1dGhcbiAgfVxuYFxuIl0sIm1hcHBpbmdzIjoiT0FBc0JBLEdBQUc7QUFBekIsT0FBTyxNQUFNQyxNQUFNLEdBQUdELEdBQUc7QUFDekI7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxDQUFDIiwiaWdub3JlTGlzdCI6W119