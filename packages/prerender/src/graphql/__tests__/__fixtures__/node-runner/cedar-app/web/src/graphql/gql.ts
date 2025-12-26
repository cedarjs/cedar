/* eslint-disable */
import * as types from "./graphql.js";
import { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 */
const documents = {
  "\n  query FindAuthorQuery($id: Int!) {\n    author: user(id: $id) {\n      email\n      fullName\n    }\n  }\n":
    types.FindAuthorQueryDocument,
  "\n  query FindBlogPostQuery($id: Int!) {\n    blogPost: post(id: $id) {\n      id\n      title\n      body\n      author {\n        email\n        fullName\n      }\n      createdAt\n    }\n  }\n":
    types.FindBlogPostQueryDocument,
  "\n    query BlogPostsQuery {\n      blogPosts: posts {\n        id\n        title\n        body\n        author {\n          email\n          fullName\n        }\n        createdAt\n      }\n    }\n  ":
    types.BlogPostsQueryDocument,
  "\n  mutation DeleteContactMutation($id: Int!) {\n    deleteContact(id: $id) {\n      id\n    }\n  }\n":
    types.DeleteContactMutationDocument,
  "\n  query FindContactById($id: Int!) {\n    contact: contact(id: $id) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n":
    types.FindContactByIdDocument,
  "\n    query FindContacts {\n      contacts {\n        id\n        name\n        email\n        message\n        createdAt\n      }\n    }\n  ":
    types.FindContactsDocument,
  "\n  query EditContactById($id: Int!) {\n    contact: contact(id: $id) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n":
    types.EditContactByIdDocument,
  "\n  mutation UpdateContactMutation($id: Int!, $input: UpdateContactInput!) {\n    updateContact(id: $id, input: $input) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n":
    types.UpdateContactMutationDocument,
  "\n  mutation CreateContactMutation($input: CreateContactInput!) {\n    createContact(input: $input) {\n      id\n    }\n  }\n":
    types.CreateContactMutationDocument,
  "\n  fragment Fruit_info on Fruit {\n    id\n    name\n    isSeedless\n    ripenessIndicators\n    stall {\n      ...Stall_info\n    }\n  }\n":
    types.Fruit_InfoFragmentDoc,
  "\n  query EditPostById($id: Int!) {\n    post: post(id: $id) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n":
    types.EditPostByIdDocument,
  "\n  mutation UpdatePostMutation($id: Int!, $input: UpdatePostInput!) {\n    updatePost(id: $id, input: $input) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n":
    types.UpdatePostMutationDocument,
  "\n  mutation CreatePostMutation($input: CreatePostInput!) {\n    createPost(input: $input) {\n      id\n    }\n  }\n":
    types.CreatePostMutationDocument,
  "\n  mutation DeletePostMutation($id: Int!) {\n    deletePost(id: $id) {\n      id\n    }\n  }\n":
    types.DeletePostMutationDocument,
  "\n    query FindPostById($id: Int!) {\n      post: post(id: $id) {\n        id\n        title\n        body\n        authorId\n        createdAt\n      }\n    }\n  ":
    types.FindPostByIdDocument,
  "\n  query FindPosts {\n    posts {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n":
    types.FindPostsDocument,
  "\n  fragment Produce_info on Produce {\n    id\n    name\n  }\n":
    types.Produce_InfoFragmentDoc,
  "\n  fragment Stall_info on Stall {\n    id\n    name\n  }\n":
    types.Stall_InfoFragmentDoc,
  "\n  fragment Vegetable_info on Vegetable {\n    id\n    name\n    vegetableFamily\n    isPickled\n    stall {\n      ...Stall_info\n    }\n  }\n":
    types.Vegetable_InfoFragmentDoc,
  "\n  query FindWaterfallBlogPostQuery($id: Int!) {\n    waterfallBlogPost: post(id: $id) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n":
    types.FindWaterfallBlogPostQueryDocument,
  "\n  query GetGroceries {\n    groceries {\n      ...Fruit_info\n      ...Vegetable_info\n    }\n  }\n":
    types.GetGroceriesDocument,
  "\n  query GetProduce {\n    produces {\n      ...Produce_info\n    }\n  }\n":
    types.GetProduceDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query FindAuthorQuery($id: Int!) {\n    author: user(id: $id) {\n      email\n      fullName\n    }\n  }\n"
): (typeof documents)["\n  query FindAuthorQuery($id: Int!) {\n    author: user(id: $id) {\n      email\n      fullName\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query FindBlogPostQuery($id: Int!) {\n    blogPost: post(id: $id) {\n      id\n      title\n      body\n      author {\n        email\n        fullName\n      }\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  query FindBlogPostQuery($id: Int!) {\n    blogPost: post(id: $id) {\n      id\n      title\n      body\n      author {\n        email\n        fullName\n      }\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n    query BlogPostsQuery {\n      blogPosts: posts {\n        id\n        title\n        body\n        author {\n          email\n          fullName\n        }\n        createdAt\n      }\n    }\n  "
): (typeof documents)["\n    query BlogPostsQuery {\n      blogPosts: posts {\n        id\n        title\n        body\n        author {\n          email\n          fullName\n        }\n        createdAt\n      }\n    }\n  "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeleteContactMutation($id: Int!) {\n    deleteContact(id: $id) {\n      id\n    }\n  }\n"
): (typeof documents)["\n  mutation DeleteContactMutation($id: Int!) {\n    deleteContact(id: $id) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query FindContactById($id: Int!) {\n    contact: contact(id: $id) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  query FindContactById($id: Int!) {\n    contact: contact(id: $id) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n    query FindContacts {\n      contacts {\n        id\n        name\n        email\n        message\n        createdAt\n      }\n    }\n  "
): (typeof documents)["\n    query FindContacts {\n      contacts {\n        id\n        name\n        email\n        message\n        createdAt\n      }\n    }\n  "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EditContactById($id: Int!) {\n    contact: contact(id: $id) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  query EditContactById($id: Int!) {\n    contact: contact(id: $id) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdateContactMutation($id: Int!, $input: UpdateContactInput!) {\n    updateContact(id: $id, input: $input) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  mutation UpdateContactMutation($id: Int!, $input: UpdateContactInput!) {\n    updateContact(id: $id, input: $input) {\n      id\n      name\n      email\n      message\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreateContactMutation($input: CreateContactInput!) {\n    createContact(input: $input) {\n      id\n    }\n  }\n"
): (typeof documents)["\n  mutation CreateContactMutation($input: CreateContactInput!) {\n    createContact(input: $input) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  fragment Fruit_info on Fruit {\n    id\n    name\n    isSeedless\n    ripenessIndicators\n    stall {\n      ...Stall_info\n    }\n  }\n"
): (typeof documents)["\n  fragment Fruit_info on Fruit {\n    id\n    name\n    isSeedless\n    ripenessIndicators\n    stall {\n      ...Stall_info\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query EditPostById($id: Int!) {\n    post: post(id: $id) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  query EditPostById($id: Int!) {\n    post: post(id: $id) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation UpdatePostMutation($id: Int!, $input: UpdatePostInput!) {\n    updatePost(id: $id, input: $input) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  mutation UpdatePostMutation($id: Int!, $input: UpdatePostInput!) {\n    updatePost(id: $id, input: $input) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation CreatePostMutation($input: CreatePostInput!) {\n    createPost(input: $input) {\n      id\n    }\n  }\n"
): (typeof documents)["\n  mutation CreatePostMutation($input: CreatePostInput!) {\n    createPost(input: $input) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  mutation DeletePostMutation($id: Int!) {\n    deletePost(id: $id) {\n      id\n    }\n  }\n"
): (typeof documents)["\n  mutation DeletePostMutation($id: Int!) {\n    deletePost(id: $id) {\n      id\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n    query FindPostById($id: Int!) {\n      post: post(id: $id) {\n        id\n        title\n        body\n        authorId\n        createdAt\n      }\n    }\n  "
): (typeof documents)["\n    query FindPostById($id: Int!) {\n      post: post(id: $id) {\n        id\n        title\n        body\n        authorId\n        createdAt\n      }\n    }\n  "];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query FindPosts {\n    posts {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  query FindPosts {\n    posts {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  fragment Produce_info on Produce {\n    id\n    name\n  }\n"
): (typeof documents)["\n  fragment Produce_info on Produce {\n    id\n    name\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  fragment Stall_info on Stall {\n    id\n    name\n  }\n"
): (typeof documents)["\n  fragment Stall_info on Stall {\n    id\n    name\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  fragment Vegetable_info on Vegetable {\n    id\n    name\n    vegetableFamily\n    isPickled\n    stall {\n      ...Stall_info\n    }\n  }\n"
): (typeof documents)["\n  fragment Vegetable_info on Vegetable {\n    id\n    name\n    vegetableFamily\n    isPickled\n    stall {\n      ...Stall_info\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query FindWaterfallBlogPostQuery($id: Int!) {\n    waterfallBlogPost: post(id: $id) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"
): (typeof documents)["\n  query FindWaterfallBlogPostQuery($id: Int!) {\n    waterfallBlogPost: post(id: $id) {\n      id\n      title\n      body\n      authorId\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query GetGroceries {\n    groceries {\n      ...Fruit_info\n      ...Vegetable_info\n    }\n  }\n"
): (typeof documents)["\n  query GetGroceries {\n    groceries {\n      ...Fruit_info\n      ...Vegetable_info\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(
  source: "\n  query GetProduce {\n    produces {\n      ...Produce_info\n    }\n  }\n"
): (typeof documents)["\n  query GetProduce {\n    produces {\n      ...Produce_info\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> =
  TDocumentNode extends DocumentNode<infer TType, any> ? TType : never;

export function gql(source: string | TemplateStringsArray) {
  if (typeof source === "string") {
    return graphql(source);
  }

  return graphql(source.join("\n"));
}
