import React from 'react'

import { Link } from 'expo-router'
import { StyleSheet } from 'react-native'

import { ThemedText } from './ThemedText'
import { ThemedView } from './ThemedView'

export interface BlogPostProps {
  blogPost: {
    id: number
    title: string
    body: string
    createdAt: string
    author: { email: string; fullName: string }
  }
  isLast: boolean
}

export function BlogPost({ blogPost, isLast }: BlogPostProps) {
  return (
    <ThemedView>
      <ThemedText style={styles.info}>
        {new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(new Date(blogPost.createdAt))}{' '}
        - By: {blogPost.author.fullName}
      </ThemedText>
      <ThemedText style={styles.info}>({blogPost.author.email})</ThemedText>
      <Link
        href={{
          pathname: '/posts/[id]',
          params: { id: blogPost.id, title: blogPost.title },
        }}
      >
        <ThemedText type="subtitle">{blogPost.title}</ThemedText>
      </Link>
      <ThemedText style={{ ...styles.body, ...(!isLast && styles.border) }}>
        {blogPost.body}
      </ThemedText>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  info: {
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    marginBlock: 8,
  },
  border: {
    paddingBottom: 8,
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
  },
})
