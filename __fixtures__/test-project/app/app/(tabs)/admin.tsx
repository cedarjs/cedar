import React from 'react'

import { gql, useQuery } from '@apollo/client'

import { Post, PostProps } from '@/components/Post'
import ThemedScrollView from '@/components/ThemedScrollView'

export const FIND_POSTS_QUERY = gql`
  query FindPosts {
    posts {
      id
      title
      body
      author {
        email
        fullName
      }
      createdAt
    }
  }
`

export default function AdminScreen() {
  const { data } = useQuery<{ posts: PostProps['post'][] }>(FIND_POSTS_QUERY)

  const posts = data?.posts ?? []

  return (
    <ThemedScrollView>
      {posts.map((post) => (
        <Post key={post.id} post={post} />
      ))}
    </ThemedScrollView>
  )
}
