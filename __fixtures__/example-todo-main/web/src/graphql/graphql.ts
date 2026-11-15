/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type AddTodo_CreateTodoMutationVariables = Exact<{
  body: string;
}>;


export type AddTodo_CreateTodoMutation = { __typename: 'Mutation', createTodo: { __typename: 'Todo', id: number, body: string, status: string } | null };

export type NumTodosCell_GetCountQueryVariables = Exact<{ [key: string]: never; }>;


export type NumTodosCell_GetCountQuery = { __typename: 'Query', todosCount: number };

export type TodoListCell_GetTodosQueryVariables = Exact<{ [key: string]: never; }>;


export type TodoListCell_GetTodosQuery = { __typename: 'Query', todos: Array<{ __typename: 'Todo', id: number, body: string, status: string } | null> | null };

export type TodoListCell_CheckTodoMutationVariables = Exact<{
  id: number;
  status: string;
}>;


export type TodoListCell_CheckTodoMutation = { __typename: 'Mutation', updateTodoStatus: { __typename: 'Todo', id: number, status: string } | null };

export type TodoStatusCell_TodoFragment = { __typename: 'Todo', id: number, status: string } & { ' $fragmentName'?: 'TodoStatusCell_TodoFragment' };

export const TodoStatusCell_TodoFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"TodoStatusCell_todo"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Todo"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]} as unknown as DocumentNode<TodoStatusCell_TodoFragment, unknown>;
export const AddTodo_CreateTodoDocument = {"__meta__":{"hash":"sha256:f98fc582f6cf1b3e8d949da27d0ce1f539002c12393d1a1a050ce5dc3dca66fa"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AddTodo_CreateTodo"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"body"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"createTodo"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"body"},"value":{"kind":"Variable","name":{"kind":"Name","value":"body"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<AddTodo_CreateTodoMutation, AddTodo_CreateTodoMutationVariables>;
export const NumTodosCell_GetCountDocument = {"__meta__":{"hash":"sha256:cb302123373222411a7ea0ff9d255b812d9879b08779a06d351a37c0023154a6"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"NumTodosCell_GetCount"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"todosCount"}}]}}]} as unknown as DocumentNode<NumTodosCell_GetCountQuery, NumTodosCell_GetCountQueryVariables>;
export const TodoListCell_GetTodosDocument = {"__meta__":{"hash":"sha256:ad70b958bdc140f38418971aaf05b44a29a9614a15af9c4cd8801bd7d77ea99b"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"TodoListCell_GetTodos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"todos"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<TodoListCell_GetTodosQuery, TodoListCell_GetTodosQueryVariables>;
export const TodoListCell_CheckTodoDocument = {"__meta__":{"hash":"sha256:71b4ff626259ef053224f6ca6ddb48f2471af34f0aa4d2c5dff410df5bb9703c"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"TodoListCell_CheckTodo"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"status"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"updateTodoStatus"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"status"},"value":{"kind":"Variable","name":{"kind":"Name","value":"status"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}}]}}]} as unknown as DocumentNode<TodoListCell_CheckTodoMutation, TodoListCell_CheckTodoMutationVariables>;