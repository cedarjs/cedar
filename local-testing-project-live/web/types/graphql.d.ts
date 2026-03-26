import { Prisma } from "$api/src/lib/db"
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
  BigInt: { input: number; output: number; }
  Byte: { input: Uint8Array; output: Uint8Array; }
  Date: { input: string; output: string; }
  DateTime: { input: string; output: string; }
  File: { input: File; output: File; }
  JSON: { input: Prisma.JsonValue; output: Prisma.JsonValue; }
  JSONObject: { input: Prisma.JsonObject; output: Prisma.JsonObject; }
  Time: { input: string; output: string; }
};

/**
 * The Cedar Root Schema
 *
 * Defines details about Cedar such as the current user and version information.
 */
export type Cedar = {
  __typename?: 'Cedar';
  /** The current user. */
  currentUser?: Maybe<Scalars['JSON']['output']>;
  /** The version of Prisma. */
  prismaVersion?: Maybe<Scalars['String']['output']>;
  /** The version of CedarJS. */
  version?: Maybe<Scalars['String']['output']>;
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
  authorId: Scalars['String']['input'];
  body: Scalars['String']['input'];
  title: Scalars['String']['input'];
};

export type CreateUserInput = {
  email: Scalars['String']['input'];
  fullName: Scalars['String']['input'];
  roles?: InputMaybe<Scalars['String']['input']>;
};

export type Mutation = {
  __typename?: 'Mutation';
  createContact?: Maybe<Contact>;
  createPost: Post;
  deleteContact: Contact;
  deletePost: Post;
  updateContact: Contact;
  updatePost: Post;
};


export type MutationcreateContactArgs = {
  input: CreateContactInput;
};


export type MutationcreatePostArgs = {
  input: CreatePostInput;
};


export type MutationdeleteContactArgs = {
  id: Scalars['Int']['input'];
};


export type MutationdeletePostArgs = {
  id: Scalars['Int']['input'];
};


export type MutationupdateContactArgs = {
  id: Scalars['Int']['input'];
  input: UpdateContactInput;
};


export type MutationupdatePostArgs = {
  id: Scalars['Int']['input'];
  input: UpdatePostInput;
};

export type Post = {
  __typename?: 'Post';
  author: User;
  authorId: Scalars['String']['output'];
  body: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['Int']['output'];
  title: Scalars['String']['output'];
};

/** About the Cedar queries. */
export type Query = {
  __typename?: 'Query';
  /** Fetches the Cedar root schema. */
  cedar?: Maybe<Cedar>;
  contact?: Maybe<Contact>;
  contacts: Array<Contact>;
  post?: Maybe<Post>;
  posts: Array<Post>;
  /**
   * Fetches the Cedar root schema.
   * @deprecated Use 'cedar' instead.
   */
  redwood?: Maybe<Redwood>;
  user?: Maybe<User>;
};


/** About the Cedar queries. */
export type QuerycontactArgs = {
  id: Scalars['Int']['input'];
};


/** About the Cedar queries. */
export type QuerypostArgs = {
  id: Scalars['Int']['input'];
};


/** About the Cedar queries. */
export type QueryuserArgs = {
  id: Scalars['String']['input'];
};

export type Redwood = {
  __typename?: 'Redwood';
  /**
   * The current user.
   * @deprecated Use the Cedar type instead.
   */
  currentUser?: Maybe<Scalars['JSON']['output']>;
  /**
   * The version of Prisma.
   * @deprecated Use the Cedar type instead.
   */
  prismaVersion?: Maybe<Scalars['String']['output']>;
  /**
   * The version of CedarJS.
   * @deprecated Use the Cedar type instead.
   */
  version?: Maybe<Scalars['String']['output']>;
};

export type UpdateContactInput = {
  email?: InputMaybe<Scalars['String']['input']>;
  message?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdatePostInput = {
  authorId?: InputMaybe<Scalars['String']['input']>;
  body?: InputMaybe<Scalars['String']['input']>;
  title?: InputMaybe<Scalars['String']['input']>;
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
  id: Scalars['String']['output'];
  posts: Array<Maybe<Post>>;
  roles?: Maybe<Scalars['String']['output']>;
};

export type FindAuthorQueryVariables = Exact<{
  id: Scalars['String']['input'];
}>;


export type FindAuthorQuery = { __typename?: 'Query', author?: { __typename?: 'User', email: string, fullName: string } | null };

export type FindBlogPostQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindBlogPostQuery = { __typename?: 'Query', blogPost?: { __typename?: 'Post', id: number, title: string, body: string, createdAt: string, author: { __typename?: 'User', email: string, fullName: string } } | null };

export type BlogPostsQueryVariables = Exact<{ [key: string]: never; }>;


export type BlogPostsQuery = { __typename?: 'Query', blogPosts: Array<{ __typename?: 'Post', id: number, title: string, body: string, createdAt: string, author: { __typename?: 'User', email: string, fullName: string } }> };

export type DeleteContactMutationVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type DeleteContactMutation = { __typename?: 'Mutation', deleteContact: { __typename?: 'Contact', id: number } };

export type FindContactByIdVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindContactById = { __typename?: 'Query', contact?: { __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string } | null };

export type FindContactsVariables = Exact<{ [key: string]: never; }>;


export type FindContacts = { __typename?: 'Query', contacts: Array<{ __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string }> };

export type EditContactByIdVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type EditContactById = { __typename?: 'Query', contact?: { __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string } | null };

export type UpdateContactMutationVariables = Exact<{
  id: Scalars['Int']['input'];
  input: UpdateContactInput;
}>;


export type UpdateContactMutation = { __typename?: 'Mutation', updateContact: { __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string } };

export type CreateContactMutationVariables = Exact<{
  input: CreateContactInput;
}>;


export type CreateContactMutation = { __typename?: 'Mutation', createContact?: { __typename?: 'Contact', id: number } | null };

export type EditPostByIdVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type EditPostById = { __typename?: 'Query', post?: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } | null };

export type UpdatePostMutationVariables = Exact<{
  id: Scalars['Int']['input'];
  input: UpdatePostInput;
}>;


export type UpdatePostMutation = { __typename?: 'Mutation', updatePost: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } };

export type CreatePostMutationVariables = Exact<{
  input: CreatePostInput;
}>;


export type CreatePostMutation = { __typename?: 'Mutation', createPost: { __typename?: 'Post', id: number } };

export type DeletePostMutationVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type DeletePostMutation = { __typename?: 'Mutation', deletePost: { __typename?: 'Post', id: number } };

export type FindPostByIdVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindPostById = { __typename?: 'Query', post?: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } | null };

export type FindPostsVariables = Exact<{ [key: string]: never; }>;


export type FindPosts = { __typename?: 'Query', posts: Array<{ __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string }> };

export type FindWaterfallBlogPostQueryVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type FindWaterfallBlogPostQuery = { __typename?: 'Query', waterfallBlogPost?: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } | null };
