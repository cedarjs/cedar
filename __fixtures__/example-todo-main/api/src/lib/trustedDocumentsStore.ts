export const store = {
  'sha256:f98fc582f6cf1b3e8d949da27d0ce1f539002c12393d1a1a050ce5dc3dca66fa':
    'mutation AddTodo_CreateTodo($body: String!) { __typename createTodo(body: $body) { __typename body id status } }',
  'sha256:cb302123373222411a7ea0ff9d255b812d9879b08779a06d351a37c0023154a6':
    'query NumTodosCell_GetCount { __typename todosCount }',
  'sha256:ad70b958bdc140f38418971aaf05b44a29a9614a15af9c4cd8801bd7d77ea99b':
    'query TodoListCell_GetTodos { __typename todos { __typename body id status } }',
  'sha256:71b4ff626259ef053224f6ca6ddb48f2471af34f0aa4d2c5dff410df5bb9703c':
    'mutation TodoListCell_CheckTodo($id: Int!, $status: String!) { __typename updateTodoStatus(id: $id, status: $status) { __typename id status } }',
}
