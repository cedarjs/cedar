/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  BigInt: { input: any; output: any; }
  Byte: { input: any; output: any; }
  Date: { input: any; output: any; }
  DateTime: { input: any; output: any; }
  File: { input: any; output: any; }
  JSON: { input: any; output: any; }
  JSONObject: { input: any; output: any; }
  Time: { input: any; output: any; }
};

export type Contact = {
  __typename?: 'Contact';
  createdAt: Scalars['DateTime']['output'];
  email: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  message: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type CreateContactInput = {
  email: Scalars['String']['input'];
  message: Scalars['String']['input'];
  name: Scalars['String']['input'];
};

export type CreatePostInput = {
  authorId: Scalars['Int']['input'];
  body: Scalars['String']['input'];
  title: Scalars['String']['input'];
};

export type CreateProduceInput = {
  isPickled?: InputMaybe<Scalars['Boolean']['input']>;
  isSeedless?: InputMaybe<Scalars['Boolean']['input']>;
  name: Scalars['String']['input'];
  nutrients?: InputMaybe<Scalars['String']['input']>;
  price: Scalars['Int']['input'];
  quantity: Scalars['Int']['input'];
  region: Scalars['String']['input'];
  ripenessIndicators?: InputMaybe<Scalars['String']['input']>;
  stallId: Scalars['String']['input'];
  vegetableFamily?: InputMaybe<Scalars['String']['input']>;
};

export type CreateStallInput = {
  name: Scalars['String']['input'];
  stallNumber: Scalars['String']['input'];
};

export type CreateUserInput = {
  email: Scalars['String']['input'];
  fullName: Scalars['String']['input'];
  roles?: InputMaybe<Scalars['String']['input']>;
};

export type Fruit = Grocery & {
  __typename?: 'Fruit';
  id: Scalars['ID']['output'];
  /** Seedless is only for fruits */
  isSeedless?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  nutrients?: Maybe<Scalars['String']['output']>;
  price: Scalars['Int']['output'];
  quantity: Scalars['Int']['output'];
  region: Scalars['String']['output'];
  /** Ripeness is only for fruits */
  ripenessIndicators?: Maybe<Scalars['String']['output']>;
  stall: Stall;
};

export type Groceries = Fruit | Vegetable;

export type Grocery = {
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  nutrients?: Maybe<Scalars['String']['output']>;
  price: Scalars['Int']['output'];
  quantity: Scalars['Int']['output'];
  region: Scalars['String']['output'];
  stall: Stall;
};

export type Mutation = {
  __typename?: 'Mutation';
  createContact?: Maybe<Contact>;
  createPost: Post;
  createProduce: Produce;
  createStall: Stall;
  deleteContact: Contact;
  deletePost: Post;
  deleteProduce: Produce;
  deleteStall: Stall;
  updateContact: Contact;
  updatePost: Post;
  updateProduce: Produce;
  updateStall: Stall;
};


export type MutationCreateContactArgs = {
  input: CreateContactInput;
};


export type MutationCreatePostArgs = {
  input: CreatePostInput;
};


export type MutationCreateProduceArgs = {
  input: CreateProduceInput;
};


export type MutationCreateStallArgs = {
  input: CreateStallInput;
};


export type MutationDeleteContactArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeletePostArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteProduceArgs = {
  id: Scalars['String']['input'];
};


export type MutationDeleteStallArgs = {
  id: Scalars['String']['input'];
};


export type MutationUpdateContactArgs = {
  id: Scalars['Int']['input'];
  input: UpdateContactInput;
};


export type MutationUpdatePostArgs = {
  id: Scalars['Int']['input'];
  input: UpdatePostInput;
};


export type MutationUpdateProduceArgs = {
  id: Scalars['String']['input'];
  input: UpdateProduceInput;
};


export type MutationUpdateStallArgs = {
  id: Scalars['String']['input'];
  input: UpdateStallInput;
};

export type Post = {
  __typename?: 'Post';
  author: User;
  authorId: Scalars['Int']['output'];
  body: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['Int']['output'];
  title: Scalars['String']['output'];
};

export type Produce = {
  __typename?: 'Produce';
  id: Scalars['String']['output'];
  isPickled?: Maybe<Scalars['Boolean']['output']>;
  isSeedless?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  nutrients?: Maybe<Scalars['String']['output']>;
  price: Scalars['Int']['output'];
  quantity: Scalars['Int']['output'];
  region: Scalars['String']['output'];
  ripenessIndicators?: Maybe<Scalars['String']['output']>;
  stall: Stall;
  stallId: Scalars['String']['output'];
  vegetableFamily?: Maybe<Scalars['String']['output']>;
};

/** About the Redwood queries. */
export type Query = {
  __typename?: 'Query';
  /** Fetches the CedarJS root schema. */
  cedarjs?: Maybe<Redwood>;
  contact?: Maybe<Contact>;
  contacts: Array<Contact>;
  fruitById?: Maybe<Fruit>;
  fruits: Array<Fruit>;
  groceries: Array<Groceries>;
  post?: Maybe<Post>;
  posts: Array<Post>;
  produce?: Maybe<Produce>;
  produces: Array<Produce>;
  /** Fetches the Redwood root schema. */
  redwood?: Maybe<Redwood>;
  stall?: Maybe<Stall>;
  stalls: Array<Stall>;
  user?: Maybe<User>;
  vegetableById?: Maybe<Vegetable>;
  vegetables: Array<Vegetable>;
};


/** About the Redwood queries. */
export type QueryContactArgs = {
  id: Scalars['Int']['input'];
};


/** About the Redwood queries. */
export type QueryFruitByIdArgs = {
  id: Scalars['ID']['input'];
};


/** About the Redwood queries. */
export type QueryPostArgs = {
  id: Scalars['Int']['input'];
};


/** About the Redwood queries. */
export type QueryProduceArgs = {
  id: Scalars['String']['input'];
};


/** About the Redwood queries. */
export type QueryStallArgs = {
  id: Scalars['String']['input'];
};


/** About the Redwood queries. */
export type QueryUserArgs = {
  id: Scalars['Int']['input'];
};


/** About the Redwood queries. */
export type QueryVegetableByIdArgs = {
  id: Scalars['ID']['input'];
};

/**
 * The Cedar Root Schema
 *
 * Defines details about Cedar such as the current user and version information.
 */
export type Redwood = {
  __typename?: 'Redwood';
  /** The current user. */
  currentUser?: Maybe<Scalars['JSON']['output']>;
  /** The version of Prisma. */
  prismaVersion?: Maybe<Scalars['String']['output']>;
  /** The version of CedarJS. */
  version?: Maybe<Scalars['String']['output']>;
};

export type Stall = {
  __typename?: 'Stall';
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  produce: Array<Maybe<Produce>>;
  stallNumber: Scalars['String']['output'];
};

export type UpdateContactInput = {
  email?: InputMaybe<Scalars['String']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdatePostInput = {
  authorId?: InputMaybe<Scalars['Int']['input']>;
  body?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateProduceInput = {
  isPickled?: InputMaybe<Scalars['Boolean']['input']>;
  isSeedless?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  nutrients?: InputMaybe<Scalars['String']['input']>;
  price?: InputMaybe<Scalars['Int']['input']>;
  quantity?: InputMaybe<Scalars['Int']['input']>;
  region?: InputMaybe<Scalars['String']['input']>;
  ripenessIndicators?: InputMaybe<Scalars['String']['input']>;
  stallId?: InputMaybe<Scalars['String']['input']>;
  vegetableFamily?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateStallInput = {
  name?: InputMaybe<Scalars['String']['input']>;
  stallNumber?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserInput = {
  email?: InputMaybe<Scalars['String']['input']>;
  fullName?: InputMaybe<Scalars['String']['input']>;
  roles?: InputMaybe<Scalars['String']['input']>;
};

export type User = {
  __typename?: 'User';
  email: Scalars['String']['output'];
  fullName: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  posts: Array<Maybe<Post>>;
  roles?: Maybe<Scalars['String']['output']>;
};

export type Vegetable = Grocery & {
  __typename?: 'Vegetable';
  id: Scalars['ID']['output'];
  /** Pickled is only for vegetables */
  isPickled?: Maybe<Scalars['Boolean']['output']>;
  name: Scalars['String']['output'];
  nutrients?: Maybe<Scalars['String']['output']>;
  price: Scalars['Int']['output'];
  quantity: Scalars['Int']['output'];
  region: Scalars['String']['output'];
  stall: Stall;
  /** Veggie Family is only for vegetables */
  vegetableFamily?: Maybe<Scalars['String']['output']>;
};

export type FindAuthorQueryQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindAuthorQueryQuery = { __typename: 'Query', author?: { __typename: 'User', email: string, fullName: string } | null };

export type FindBlogPostQueryQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindBlogPostQueryQuery = { __typename: 'Query', blogPost?: { __typename: 'Post', id: number, title: string, body: string, createdAt: any, author: { __typename: 'User', email: string, fullName: string } } | null };

export type BlogPostsQueryQueryVariables = Exact<{ [key: string]: never; }>;


export type BlogPostsQueryQuery = { __typename: 'Query', blogPosts: Array<{ __typename: 'Post', id: number, title: string, body: string, createdAt: any, author: { __typename: 'User', email: string, fullName: string } }> };

export type DeleteContactMutationMutationVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type DeleteContactMutationMutation = { __typename: 'Mutation', deleteContact: { __typename: 'Contact', id: number } };

export type FindContactByIdQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindContactByIdQuery = { __typename: 'Query', contact?: { __typename: 'Contact', id: number, name: string, email: string, message: string, createdAt: any } | null };

export type FindContactsQueryVariables = Exact<{ [key: string]: never; }>;


export type FindContactsQuery = { __typename: 'Query', contacts: Array<{ __typename: 'Contact', id: number, name: string, email: string, message: string, createdAt: any }> };

export type EditContactByIdQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type EditContactByIdQuery = { __typename: 'Query', contact?: { __typename: 'Contact', id: number, name: string, email: string, message: string, createdAt: any } | null };

export type UpdateContactMutationMutationVariables = Exact<{
  id: Scalars['Int']['input'];
  input: UpdateContactInput;
}>;


export type UpdateContactMutationMutation = { __typename: 'Mutation', updateContact: { __typename: 'Contact', id: number, name: string, email: string, message: string, createdAt: any } };

export type CreateContactMutationMutationVariables = Exact<{
  input: CreateContactInput;
}>;


export type CreateContactMutationMutation = { __typename: 'Mutation', createContact?: { __typename: 'Contact', id: number } | null };

export type Fruit_InfoFragment = { __typename: 'Fruit', id: string, name: string, isSeedless?: boolean | null, ripenessIndicators?: string | null, stall: (
    { __typename: 'Stall' }
    & { ' $fragmentRefs'?: { 'Stall_InfoFragment': Stall_InfoFragment } }
  ) } & { ' $fragmentName'?: 'Fruit_InfoFragment' };

export type EditPostByIdQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type EditPostByIdQuery = { __typename: 'Query', post?: { __typename: 'Post', id: number, title: string, body: string, authorId: number, createdAt: any } | null };

export type UpdatePostMutationMutationVariables = Exact<{
  id: Scalars['Int']['input'];
  input: UpdatePostInput;
}>;


export type UpdatePostMutationMutation = { __typename: 'Mutation', updatePost: { __typename: 'Post', id: number, title: string, body: string, authorId: number, createdAt: any } };

export type CreatePostMutationMutationVariables = Exact<{
  input: CreatePostInput;
}>;


export type CreatePostMutationMutation = { __typename: 'Mutation', createPost: { __typename: 'Post', id: number } };

export type DeletePostMutationMutationVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type DeletePostMutationMutation = { __typename: 'Mutation', deletePost: { __typename: 'Post', id: number } };

export type FindPostByIdQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindPostByIdQuery = { __typename: 'Query', post?: { __typename: 'Post', id: number, title: string, body: string, authorId: number, createdAt: any } | null };

export type FindPostsQueryVariables = Exact<{ [key: string]: never; }>;


export type FindPostsQuery = { __typename: 'Query', posts: Array<{ __typename: 'Post', id: number, title: string, body: string, authorId: number, createdAt: any }> };

export type Produce_InfoFragment = { __typename: 'Produce', id: string, name: string } & { ' $fragmentName'?: 'Produce_InfoFragment' };

export type Stall_InfoFragment = { __typename: 'Stall', id: string, name: string } & { ' $fragmentName'?: 'Stall_InfoFragment' };

export type Vegetable_InfoFragment = { __typename: 'Vegetable', id: string, name: string, vegetableFamily?: string | null, isPickled?: boolean | null, stall: (
    { __typename: 'Stall' }
    & { ' $fragmentRefs'?: { 'Stall_InfoFragment': Stall_InfoFragment } }
  ) } & { ' $fragmentName'?: 'Vegetable_InfoFragment' };

export type FindWaterfallBlogPostQueryQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindWaterfallBlogPostQueryQuery = { __typename: 'Query', waterfallBlogPost?: { __typename: 'Post', id: number, title: string, body: string, authorId: number, createdAt: any } | null };

export type GetGroceriesQueryVariables = Exact<{ [key: string]: never; }>;


export type GetGroceriesQuery = { __typename: 'Query', groceries: Array<(
    { __typename: 'Fruit' }
    & { ' $fragmentRefs'?: { 'Fruit_InfoFragment': Fruit_InfoFragment } }
  ) | (
    { __typename: 'Vegetable' }
    & { ' $fragmentRefs'?: { 'Vegetable_InfoFragment': Vegetable_InfoFragment } }
  )> };

export type GetProduceQueryVariables = Exact<{ [key: string]: never; }>;


export type GetProduceQuery = { __typename: 'Query', produces: Array<(
    { __typename: 'Produce' }
    & { ' $fragmentRefs'?: { 'Produce_InfoFragment': Produce_InfoFragment } }
  )> };

export const Stall_InfoFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Stall_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Stall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<Stall_InfoFragment, unknown>;
export const Fruit_InfoFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Fruit_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Fruit"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"isSeedless"}},{"kind":"Field","name":{"kind":"Name","value":"ripenessIndicators"}},{"kind":"Field","name":{"kind":"Name","value":"stall"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"Stall_info"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Stall_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Stall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<Fruit_InfoFragment, unknown>;
export const Produce_InfoFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Produce_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Produce"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<Produce_InfoFragment, unknown>;
export const Vegetable_InfoFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Vegetable_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Vegetable"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"vegetableFamily"}},{"kind":"Field","name":{"kind":"Name","value":"isPickled"}},{"kind":"Field","name":{"kind":"Name","value":"stall"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"Stall_info"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Stall_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Stall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<Vegetable_InfoFragment, unknown>;
export const FindAuthorQueryDocument = {"__meta__":{"hash":"4dd4c49aef34e20af52efb50a1d0ebb0b8062b6d"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindAuthorQuery"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"author"},"name":{"kind":"Name","value":"user"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}}]}}]} as unknown as DocumentNode<FindAuthorQueryQuery, FindAuthorQueryQueryVariables>;
export const FindBlogPostQueryDocument = {"__meta__":{"hash":"46e9823d95110ebb2ef17ef82fff5c19a468f8a6"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindBlogPostQuery"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"blogPost"},"name":{"kind":"Name","value":"post"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"author"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<FindBlogPostQueryQuery, FindBlogPostQueryQueryVariables>;
export const BlogPostsQueryDocument = {"__meta__":{"hash":"421bcffdde84d448ec1a1b30b36eaeb966f00257"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"BlogPostsQuery"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"blogPosts"},"name":{"kind":"Name","value":"posts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"author"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"fullName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<BlogPostsQueryQuery, BlogPostsQueryQueryVariables>;
export const DeleteContactMutationDocument = {"__meta__":{"hash":"f6ae606548009c2cd4c69b9aecebad0a730ba23d"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteContactMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deleteContact"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeleteContactMutationMutation, DeleteContactMutationMutationVariables>;
export const FindContactByIdDocument = {"__meta__":{"hash":"f7d2df28fcf87b0c29d225df79363d1c69159916"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindContactById"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"contact"},"name":{"kind":"Name","value":"contact"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<FindContactByIdQuery, FindContactByIdQueryVariables>;
export const FindContactsDocument = {"__meta__":{"hash":"7af93a7e454d9c59bbb77c14e0c78e99207fd0c6"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindContacts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"contacts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<FindContactsQuery, FindContactsQueryVariables>;
export const EditContactByIdDocument = {"__meta__":{"hash":"e01ad8e899ac908458eac2d1f989b88160a0494b"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EditContactById"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"contact"},"name":{"kind":"Name","value":"contact"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<EditContactByIdQuery, EditContactByIdQueryVariables>;
export const UpdateContactMutationDocument = {"__meta__":{"hash":"94f51784b918a52e9af64f3c1fd4356903b611f8"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateContactMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdateContactInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"updateContact"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<UpdateContactMutationMutation, UpdateContactMutationMutationVariables>;
export const CreateContactMutationDocument = {"__meta__":{"hash":"da35778949e1e8e27b7d1bb6b2a630749c5d7060"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateContactMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreateContactInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"createContact"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreateContactMutationMutation, CreateContactMutationMutationVariables>;
export const EditPostByIdDocument = {"__meta__":{"hash":"4f880f909a16b7fe15898fe33a2ee26933466719"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"EditPostById"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"post"},"name":{"kind":"Name","value":"post"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<EditPostByIdQuery, EditPostByIdQueryVariables>;
export const UpdatePostMutationDocument = {"__meta__":{"hash":"32b9225df81ff7845fedfa6d5c86c5d4a76073d2"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdatePostMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"UpdatePostInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"updatePost"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}},{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<UpdatePostMutationMutation, UpdatePostMutationMutationVariables>;
export const CreatePostMutationDocument = {"__meta__":{"hash":"daf229dcea085f1beff91102a63c2ba9c88e8481"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreatePostMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CreatePostInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"createPost"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<CreatePostMutationMutation, CreatePostMutationMutationVariables>;
export const DeletePostMutationDocument = {"__meta__":{"hash":"e3405f6dcb6460943dd604423f0f517bc8318aaa"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeletePostMutation"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"deletePost"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode<DeletePostMutationMutation, DeletePostMutationMutationVariables>;
export const FindPostByIdDocument = {"__meta__":{"hash":"43a94ad9a150aa7a7a665c73a931a5b18b6cc28b"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindPostById"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"post"},"name":{"kind":"Name","value":"post"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<FindPostByIdQuery, FindPostByIdQueryVariables>;
export const FindPostsDocument = {"__meta__":{"hash":"76308e971322b1ece4cdff75185bb61d7139e343"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindPosts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"posts"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<FindPostsQuery, FindPostsQueryVariables>;
export const FindWaterfallBlogPostQueryDocument = {"__meta__":{"hash":"2f2487bd6a7c61ff1a0bc8fd1893e410263544e4"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"FindWaterfallBlogPostQuery"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","alias":{"kind":"Name","value":"waterfallBlogPost"},"name":{"kind":"Name","value":"post"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"body"}},{"kind":"Field","name":{"kind":"Name","value":"authorId"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<FindWaterfallBlogPostQueryQuery, FindWaterfallBlogPostQueryQueryVariables>;
export const GetGroceriesDocument = {"__meta__":{"hash":"e670c1eb2c308fc51ee5cab093b46e2c4b9d7c76"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetGroceries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"groceries"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"Fruit_info"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"Vegetable_info"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Stall_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Stall"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Fruit_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Fruit"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"isSeedless"}},{"kind":"Field","name":{"kind":"Name","value":"ripenessIndicators"}},{"kind":"Field","name":{"kind":"Name","value":"stall"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"Stall_info"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Vegetable_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Vegetable"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"vegetableFamily"}},{"kind":"Field","name":{"kind":"Name","value":"isPickled"}},{"kind":"Field","name":{"kind":"Name","value":"stall"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"Stall_info"}}]}}]}}]} as unknown as DocumentNode<GetGroceriesQuery, GetGroceriesQueryVariables>;
export const GetProduceDocument = {"__meta__":{"hash":"9bc4706c13428a12d7afe31e27306844fdceb137"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetProduce"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"produces"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"FragmentSpread","name":{"kind":"Name","value":"Produce_info"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"Produce_info"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Produce"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<GetProduceQuery, GetProduceQueryVariables>;