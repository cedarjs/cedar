import React, { useEffect } from 'react'

import { gql, useQuery } from '@apollo/client'
import { useLocalSearchParams, useNavigation } from 'expo-router'

import { BlogPost, BlogPostProps } from '@/components/BlogPost'
import ThemedScrollView from '@/components/ThemedScrollView'
import { ThemedView } from '@/components/ThemedView'

const QUERY = gql`
  query FindPostById($id: Int!) {
    post(id: $id) {
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

export default function PostScreen() {
  const navigation = useNavigation()
  const { id, title } = useLocalSearchParams<{ id: string; title: string }>()
  const { data } = useQuery<{ post: BlogPostProps['blogPost'] }>(QUERY, {
    variables: { id: Number(id) },
  })

  useEffect(() => {
    navigation.setOptions({ title })
  }, [])

  const blogPost = data?.post

  return (
    <ThemedScrollView>
      <ThemedView>
        {blogPost ? (
          <BlogPost key={blogPost.id} blogPost={blogPost} isLast={true} />
        ) : null}
      </ThemedView>
    </ThemedScrollView>
  )
}
