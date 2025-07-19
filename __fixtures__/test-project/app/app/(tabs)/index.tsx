import React from 'react'

import { gql, useQuery } from '@apollo/client'

import { BlogPost, BlogPostProps } from '@/components/BlogPost'
import ThemedScrollView from '@/components/ThemedScrollView'
import { ThemedView } from '@/components/ThemedView'

const QUERY = gql`
  query BlogPostsQuery {
    blogPosts: posts {
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

export default function HomeScreen() {
  const { data } = useQuery(QUERY)

  const blogPosts: BlogPostProps['blogPost'][] = data?.blogPosts ?? []

  return (
    <ThemedScrollView>
      <ThemedView>
        {blogPosts.map((blogPost, index) => (
          <BlogPost
            key={blogPost.id}
            blogPost={blogPost}
            isLast={index === blogPosts.length - 1}
          />
        ))}
      </ThemedView>
    </ThemedScrollView>
  )
}
