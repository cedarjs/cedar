import { Prisma } from "@prisma/client"
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  BigInt: number;
  Byte: Uint8Array;
  Date: string;
  DateTime: string;
  File: File;
  JSON: Prisma.JsonValue;
  JSONObject: Prisma.JsonObject;
  Time: string;
};

/**
 * The Cedar Root Schema
 *
 * Defines details about Cedar such as the current user and version information.
 */
export type Cedar = {
  __typename?: 'Cedar';
  /** The current user. */
  currentUser?: Maybe<Scalars['JSON']>;
  /** The version of Prisma. */
  prismaVersion?: Maybe<Scalars['String']>;
  /** The version of CedarJS. */
  version?: Maybe<Scalars['String']>;
};

export type Contact = {
  __typename?: 'Contact';
  createdAt: Scalars['DateTime'];
  email: Scalars['String'];
  id: Scalars['Int'];
  message: Scalars['String'];
  name: Scalars['String'];
};

export type CreateContactInput = {
  email: Scalars['String'];
  message: Scalars['String'];
  name: Scalars['String'];
};

export type CreatePostInput = {
  authorId: Scalars['String'];
  body: Scalars['String'];
  title: Scalars['String'];
};

export type CreateUserInput = {
  email: Scalars['String'];
  fullName: Scalars['String'];
  roles?: InputMaybe<Scalars['String']>;
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
  id: Scalars['Int'];
};


export type MutationdeletePostArgs = {
  id: Scalars['Int'];
};


export type MutationupdateContactArgs = {
  id: Scalars['Int'];
  input: UpdateContactInput;
};


export type MutationupdatePostArgs = {
  id: Scalars['Int'];
  input: UpdatePostInput;
};

export type Post = {
  __typename?: 'Post';
  author: User;
  authorId: Scalars['String'];
  body: Scalars['String'];
  createdAt: Scalars['DateTime'];
  id: Scalars['Int'];
  title: Scalars['String'];
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
  id: Scalars['Int'];
};


/** About the Cedar queries. */
export type QuerypostArgs = {
  id: Scalars['Int'];
};


/** About the Cedar queries. */
export type QueryuserArgs = {
  id: Scalars['String'];
};

export type Redwood = {
  __typename?: 'Redwood';
  /**
   * The current user.
   * @deprecated Use the Cedar type instead.
   */
  currentUser?: Maybe<Scalars['JSON']>;
  /**
   * The version of Prisma.
   * @deprecated Use the Cedar type instead.
   */
  prismaVersion?: Maybe<Scalars['String']>;
  /**
   * The version of CedarJS.
   * @deprecated Use the Cedar type instead.
   */
  version?: Maybe<Scalars['String']>;
};

export type UpdateContactInput = {
  email?: InputMaybe<Scalars['String']>;
  message?: InputMaybe<Scalars['String']>;
  name?: InputMaybe<Scalars['String']>;
};

export type UpdatePostInput = {
  authorId?: InputMaybe<Scalars['String']>;
  body?: InputMaybe<Scalars['String']>;
  title?: InputMaybe<Scalars['String']>;
};

export type UpdateUserInput = {
  email?: InputMaybe<Scalars['String']>;
  fullName?: InputMaybe<Scalars['String']>;
  roles?: InputMaybe<Scalars['String']>;
};

export type User = {
  __typename?: 'User';
  email: Scalars['String'];
  fullName: Scalars['String'];
  id: Scalars['String'];
  posts: Array<Maybe<Post>>;
  roles?: Maybe<Scalars['String']>;
};

export type FindAuthorQueryVariables = Exact<{
  id: Scalars['String'];
}>;


export type FindAuthorQuery = { __typename?: 'Query', author?: { __typename?: 'User', email: string, fullName: string } | null };

export type FindBlogPostQueryVariables = Exact<{
  id: Scalars['Int'];
}>;


export type FindBlogPostQuery = { __typename?: 'Query', blogPost?: { __typename?: 'Post', id: number, title: string, body: string, createdAt: string, author: { __typename?: 'User', email: string, fullName: string } } | null };

export type BlogPostsQueryVariables = Exact<{ [key: string]: never; }>;


export type BlogPostsQuery = { __typename?: 'Query', blogPosts: Array<{ __typename?: 'Post', id: number, title: string, body: string, createdAt: string, author: { __typename?: 'User', email: string, fullName: string } }> };

export type DeleteContactMutationVariables = Exact<{
  id: Scalars['Int'];
}>;


export type DeleteContactMutation = { __typename?: 'Mutation', deleteContact: { __typename?: 'Contact', id: number } };

export type FindContactByIdVariables = Exact<{
  id: Scalars['Int'];
}>;


export type FindContactById = { __typename?: 'Query', contact?: { __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string } | null };

export type FindContactsVariables = Exact<{ [key: string]: never; }>;


export type FindContacts = { __typename?: 'Query', contacts: Array<{ __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string }> };

export type EditContactByIdVariables = Exact<{
  id: Scalars['Int'];
}>;


export type EditContactById = { __typename?: 'Query', contact?: { __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string } | null };

export type UpdateContactMutationVariables = Exact<{
  id: Scalars['Int'];
  input: UpdateContactInput;
}>;


export type UpdateContactMutation = { __typename?: 'Mutation', updateContact: { __typename?: 'Contact', id: number, name: string, email: string, message: string, createdAt: string } };

export type CreateContactMutationVariables = Exact<{
  input: CreateContactInput;
}>;


export type CreateContactMutation = { __typename?: 'Mutation', createContact?: { __typename?: 'Contact', id: number } | null };

export type EditPostByIdVariables = Exact<{
  id: Scalars['Int'];
}>;


export type EditPostById = { __typename?: 'Query', post?: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } | null };

export type UpdatePostMutationVariables = Exact<{
  id: Scalars['Int'];
  input: UpdatePostInput;
}>;


export type UpdatePostMutation = { __typename?: 'Mutation', updatePost: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } };

export type CreatePostMutationVariables = Exact<{
  input: CreatePostInput;
}>;


export type CreatePostMutation = { __typename?: 'Mutation', createPost: { __typename?: 'Post', id: number } };

export type DeletePostMutationVariables = Exact<{
  id: Scalars['Int'];
}>;


export type DeletePostMutation = { __typename?: 'Mutation', deletePost: { __typename?: 'Post', id: number } };

export type FindPostByIdVariables = Exact<{
  id: Scalars['Int'];
}>;


export type FindPostById = { __typename?: 'Query', post?: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } | null };

export type FindPostsVariables = Exact<{ [key: string]: never; }>;


export type FindPosts = { __typename?: 'Query', posts: Array<{ __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string }> };

export type FindWaterfallBlogPostQueryVariables = Exact<{
  id: Scalars['Int'];
}>;


export type FindWaterfallBlogPostQuery = { __typename?: 'Query', waterfallBlogPost?: { __typename?: 'Post', id: number, title: string, body: string, authorId: string, createdAt: string } | null };
