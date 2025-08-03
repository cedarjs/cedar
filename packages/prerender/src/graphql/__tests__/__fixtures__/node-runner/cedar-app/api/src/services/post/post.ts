// Sample post service for testing directory imports

export interface Post {
  id: string
  title: string
  content: string
  authorId: string
  createdAt: Date
}

export const post = async (id: string): Promise<Post> => {
  return {
    id,
    title: 'Sample Post',
    content: 'This is a sample post content',
    authorId: 'user123',
    createdAt: new Date()
  }
}

export const posts = async (): Promise<Post[]> => {
  return [
    {
      id: '1',
      title: 'First Post',
      content: 'Content of first post',
      authorId: 'user1',
      createdAt: new Date()
    }
  ]
}

export const createPost = async (postData: Omit<Post, 'id' | 'createdAt'>): Promise<Post> => {
  return {
    id: Math.random().toString(36),
    createdAt: new Date(),
    ...postData
  }
}

export const postServiceName = 'postService'

export default {
  post,
  posts,
  createPost,
  postServiceName
}
