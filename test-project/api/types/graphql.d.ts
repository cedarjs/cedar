import { Prisma } from "@prisma/client"
import { MergePrismaWithSdlTypes, MakeRelationsOptional } from '@cedarjs/api'
import { UserExample as PrismaUserExample, Post as PrismaPost, User as PrismaUser, Contact as PrismaContact } from '@prisma/client'
import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import { CedarGraphQLContext } from '@cedarjs/graphql-server/dist/types';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type ResolverFn<TResult, TParent, TContext, TArgs> = (
      args?: TArgs,
      obj?: { root: TParent; context: TContext; info: GraphQLResolveInfo }
    ) => TResult | Promise<TResult>
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
export type OptArgsResolverFn<TResult, TParent = {}, TContext = {}, TArgs = {}> = (
      args?: TArgs,
      obj?: { root: TParent; context: TContext; info: GraphQLResolveInfo }
    ) => TResult | Promise<TResult>

    export type RequiredResolverFn<TResult, TParent = {}, TContext = {}, TArgs = {}> = (
      args: TArgs,
      obj: { root: TParent; context: TContext; info: GraphQLResolveInfo }
    ) => TResult | Promise<TResult>
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  BigInt: number;
  Byte: Uint8Array;
  Date: Date | string;
  DateTime: Date | string;
  File: File;
  JSON: Prisma.JsonValue;
  JSONObject: Prisma.JsonObject;
  Time: Date | string;
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

type MaybeOrArrayOfMaybe<T> = T | Maybe<T> | Maybe<T>[];
type AllMappedModels = MaybeOrArrayOfMaybe<Contact | Post | User>


export type ResolverTypeWrapper<T> = Promise<T> | T;

export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> = ResolverFn<TResult, TParent, TContext, TArgs>;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = {}, TContext = {}, TArgs = {}> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = {}, TContext = {}> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  BigInt: ResolverTypeWrapper<Scalars['BigInt']>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']>;
  Byte: ResolverTypeWrapper<Scalars['Byte']>;
  Cedar: ResolverTypeWrapper<Cedar>;
  Contact: ResolverTypeWrapper<MergePrismaWithSdlTypes<PrismaContact, MakeRelationsOptional<Contact, AllMappedModels>, AllMappedModels>>;
  CreateContactInput: CreateContactInput;
  CreatePostInput: CreatePostInput;
  CreateUserInput: CreateUserInput;
  Date: ResolverTypeWrapper<Scalars['Date']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']>;
  File: ResolverTypeWrapper<Scalars['File']>;
  Int: ResolverTypeWrapper<Scalars['Int']>;
  JSON: ResolverTypeWrapper<Scalars['JSON']>;
  JSONObject: ResolverTypeWrapper<Scalars['JSONObject']>;
  Mutation: ResolverTypeWrapper<{}>;
  Post: ResolverTypeWrapper<MergePrismaWithSdlTypes<PrismaPost, MakeRelationsOptional<Post, AllMappedModels>, AllMappedModels>>;
  Query: ResolverTypeWrapper<{}>;
  Redwood: ResolverTypeWrapper<Redwood>;
  String: ResolverTypeWrapper<Scalars['String']>;
  Time: ResolverTypeWrapper<Scalars['Time']>;
  UpdateContactInput: UpdateContactInput;
  UpdatePostInput: UpdatePostInput;
  UpdateUserInput: UpdateUserInput;
  User: ResolverTypeWrapper<MergePrismaWithSdlTypes<PrismaUser, MakeRelationsOptional<User, AllMappedModels>, AllMappedModels>>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  BigInt: Scalars['BigInt'];
  Boolean: Scalars['Boolean'];
  Byte: Scalars['Byte'];
  Cedar: Cedar;
  Contact: MergePrismaWithSdlTypes<PrismaContact, MakeRelationsOptional<Contact, AllMappedModels>, AllMappedModels>;
  CreateContactInput: CreateContactInput;
  CreatePostInput: CreatePostInput;
  CreateUserInput: CreateUserInput;
  Date: Scalars['Date'];
  DateTime: Scalars['DateTime'];
  File: Scalars['File'];
  Int: Scalars['Int'];
  JSON: Scalars['JSON'];
  JSONObject: Scalars['JSONObject'];
  Mutation: {};
  Post: MergePrismaWithSdlTypes<PrismaPost, MakeRelationsOptional<Post, AllMappedModels>, AllMappedModels>;
  Query: {};
  Redwood: Redwood;
  String: Scalars['String'];
  Time: Scalars['Time'];
  UpdateContactInput: UpdateContactInput;
  UpdatePostInput: UpdatePostInput;
  UpdateUserInput: UpdateUserInput;
  User: MergePrismaWithSdlTypes<PrismaUser, MakeRelationsOptional<User, AllMappedModels>, AllMappedModels>;
};

export type requireAuthDirectiveArgs = {
  roles?: Maybe<Array<Maybe<Scalars['String']>>>;
};

export type requireAuthDirectiveResolver<Result, Parent, ContextType = CedarGraphQLContext, Args = requireAuthDirectiveArgs> = DirectiveResolverFn<Result, Parent, ContextType, Args>;

export type skipAuthDirectiveArgs = { };

export type skipAuthDirectiveResolver<Result, Parent, ContextType = CedarGraphQLContext, Args = skipAuthDirectiveArgs> = DirectiveResolverFn<Result, Parent, ContextType, Args>;

export interface BigIntScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['BigInt'], any> {
  name: 'BigInt';
}

export interface ByteScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Byte'], any> {
  name: 'Byte';
}

export type CedarResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Cedar'] = ResolversParentTypes['Cedar']> = {
  currentUser: OptArgsResolverFn<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  prismaVersion: OptArgsResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  version: OptArgsResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CedarRelationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Cedar'] = ResolversParentTypes['Cedar']> = {
  currentUser?: RequiredResolverFn<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  prismaVersion?: RequiredResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  version?: RequiredResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ContactResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Contact'] = ResolversParentTypes['Contact']> = {
  createdAt: OptArgsResolverFn<ResolversTypes['DateTime'], ParentType, ContextType>;
  email: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  id: OptArgsResolverFn<ResolversTypes['Int'], ParentType, ContextType>;
  message: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  name: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ContactRelationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Contact'] = ResolversParentTypes['Contact']> = {
  createdAt?: RequiredResolverFn<ResolversTypes['DateTime'], ParentType, ContextType>;
  email?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  id?: RequiredResolverFn<ResolversTypes['Int'], ParentType, ContextType>;
  message?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  name?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export interface DateScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Date'], any> {
  name: 'Date';
}

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export interface FileScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['File'], any> {
  name: 'File';
}

export interface JSONScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export interface JSONObjectScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSONObject'], any> {
  name: 'JSONObject';
}

export type MutationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  createContact: Resolver<Maybe<ResolversTypes['Contact']>, ParentType, ContextType, RequireFields<MutationcreateContactArgs, 'input'>>;
  createPost: Resolver<ResolversTypes['Post'], ParentType, ContextType, RequireFields<MutationcreatePostArgs, 'input'>>;
  deleteContact: Resolver<ResolversTypes['Contact'], ParentType, ContextType, RequireFields<MutationdeleteContactArgs, 'id'>>;
  deletePost: Resolver<ResolversTypes['Post'], ParentType, ContextType, RequireFields<MutationdeletePostArgs, 'id'>>;
  updateContact: Resolver<ResolversTypes['Contact'], ParentType, ContextType, RequireFields<MutationupdateContactArgs, 'id' | 'input'>>;
  updatePost: Resolver<ResolversTypes['Post'], ParentType, ContextType, RequireFields<MutationupdatePostArgs, 'id' | 'input'>>;
};

export type MutationRelationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  createContact?: RequiredResolverFn<Maybe<ResolversTypes['Contact']>, ParentType, ContextType, RequireFields<MutationcreateContactArgs, 'input'>>;
  createPost?: RequiredResolverFn<ResolversTypes['Post'], ParentType, ContextType, RequireFields<MutationcreatePostArgs, 'input'>>;
  deleteContact?: RequiredResolverFn<ResolversTypes['Contact'], ParentType, ContextType, RequireFields<MutationdeleteContactArgs, 'id'>>;
  deletePost?: RequiredResolverFn<ResolversTypes['Post'], ParentType, ContextType, RequireFields<MutationdeletePostArgs, 'id'>>;
  updateContact?: RequiredResolverFn<ResolversTypes['Contact'], ParentType, ContextType, RequireFields<MutationupdateContactArgs, 'id' | 'input'>>;
  updatePost?: RequiredResolverFn<ResolversTypes['Post'], ParentType, ContextType, RequireFields<MutationupdatePostArgs, 'id' | 'input'>>;
};

export type PostResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Post'] = ResolversParentTypes['Post']> = {
  author: OptArgsResolverFn<ResolversTypes['User'], ParentType, ContextType>;
  authorId: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  body: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  createdAt: OptArgsResolverFn<ResolversTypes['DateTime'], ParentType, ContextType>;
  id: OptArgsResolverFn<ResolversTypes['Int'], ParentType, ContextType>;
  title: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PostRelationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Post'] = ResolversParentTypes['Post']> = {
  author?: RequiredResolverFn<ResolversTypes['User'], ParentType, ContextType>;
  authorId?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  body?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: RequiredResolverFn<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: RequiredResolverFn<ResolversTypes['Int'], ParentType, ContextType>;
  title?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type QueryResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  cedar: OptArgsResolverFn<Maybe<ResolversTypes['Cedar']>, ParentType, ContextType>;
  contact: Resolver<Maybe<ResolversTypes['Contact']>, ParentType, ContextType, RequireFields<QuerycontactArgs, 'id'>>;
  contacts: OptArgsResolverFn<Array<ResolversTypes['Contact']>, ParentType, ContextType>;
  post: Resolver<Maybe<ResolversTypes['Post']>, ParentType, ContextType, RequireFields<QuerypostArgs, 'id'>>;
  posts: OptArgsResolverFn<Array<ResolversTypes['Post']>, ParentType, ContextType>;
  redwood: OptArgsResolverFn<Maybe<ResolversTypes['Redwood']>, ParentType, ContextType>;
  user: Resolver<Maybe<ResolversTypes['User']>, ParentType, ContextType, RequireFields<QueryuserArgs, 'id'>>;
};

export type QueryRelationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  cedar?: RequiredResolverFn<Maybe<ResolversTypes['Cedar']>, ParentType, ContextType>;
  contact?: RequiredResolverFn<Maybe<ResolversTypes['Contact']>, ParentType, ContextType, RequireFields<QuerycontactArgs, 'id'>>;
  contacts?: RequiredResolverFn<Array<ResolversTypes['Contact']>, ParentType, ContextType>;
  post?: RequiredResolverFn<Maybe<ResolversTypes['Post']>, ParentType, ContextType, RequireFields<QuerypostArgs, 'id'>>;
  posts?: RequiredResolverFn<Array<ResolversTypes['Post']>, ParentType, ContextType>;
  redwood?: RequiredResolverFn<Maybe<ResolversTypes['Redwood']>, ParentType, ContextType>;
  user?: RequiredResolverFn<Maybe<ResolversTypes['User']>, ParentType, ContextType, RequireFields<QueryuserArgs, 'id'>>;
};

export type RedwoodResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Redwood'] = ResolversParentTypes['Redwood']> = {
  currentUser: OptArgsResolverFn<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  prismaVersion: OptArgsResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  version: OptArgsResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type RedwoodRelationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['Redwood'] = ResolversParentTypes['Redwood']> = {
  currentUser?: RequiredResolverFn<Maybe<ResolversTypes['JSON']>, ParentType, ContextType>;
  prismaVersion?: RequiredResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  version?: RequiredResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export interface TimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Time'], any> {
  name: 'Time';
}

export type UserResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User']> = {
  email: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  fullName: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  id: OptArgsResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  posts: OptArgsResolverFn<Array<Maybe<ResolversTypes['Post']>>, ParentType, ContextType>;
  roles: OptArgsResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type UserRelationResolvers<ContextType = CedarGraphQLContext, ParentType extends ResolversParentTypes['User'] = ResolversParentTypes['User']> = {
  email?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  fullName?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  id?: RequiredResolverFn<ResolversTypes['String'], ParentType, ContextType>;
  posts?: RequiredResolverFn<Array<Maybe<ResolversTypes['Post']>>, ParentType, ContextType>;
  roles?: RequiredResolverFn<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type Resolvers<ContextType = CedarGraphQLContext> = {
  BigInt: GraphQLScalarType;
  Byte: GraphQLScalarType;
  Cedar: CedarResolvers<ContextType>;
  Contact: ContactResolvers<ContextType>;
  Date: GraphQLScalarType;
  DateTime: GraphQLScalarType;
  File: GraphQLScalarType;
  JSON: GraphQLScalarType;
  JSONObject: GraphQLScalarType;
  Mutation: MutationResolvers<ContextType>;
  Post: PostResolvers<ContextType>;
  Query: QueryResolvers<ContextType>;
  Redwood: RedwoodResolvers<ContextType>;
  Time: GraphQLScalarType;
  User: UserResolvers<ContextType>;
};

export type DirectiveResolvers<ContextType = CedarGraphQLContext> = {
  requireAuth: requireAuthDirectiveResolver<any, any, ContextType>;
  skipAuth: skipAuthDirectiveResolver<any, any, ContextType>;
};
