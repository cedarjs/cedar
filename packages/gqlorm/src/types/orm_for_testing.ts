import type {
  FindManyArgs,
  FindUniqueArgs,
  IncludeInput,
  OrderByInput,
  SelectInput,
  WhereInput,
} from './orm.js'

// Example model types (for reference/testing)
export interface User {
  id: string
  email: string
  name: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  posts?: Post[]
  profile?: Profile
}

export interface Post {
  id: number
  title: string
  content: string | null
  published: boolean
  authorId: number
  createdAt: Date
  updatedAt: Date
  author?: User
  comments?: Comment[]
}

export interface Comment {
  id: number
  content: string
  postId: number
  authorId: number
  createdAt: Date
  post?: Post
  author?: User
}

export interface Profile {
  id: number
  bio: string | null
  userId: number
  user?: User
}

// Example usage types
export type UserWhereInput = WhereInput<User>
export type UserSelectInput = SelectInput<User>
export type UserIncludeInput = IncludeInput<User>
export type UserOrderByInput = OrderByInput<User>
export type UserFindManyArgs = FindManyArgs<User>
export type UserFindUniqueArgs = FindUniqueArgs<User>
