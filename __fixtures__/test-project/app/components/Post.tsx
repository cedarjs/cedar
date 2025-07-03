import React from 'react'

import { gql, useMutation } from '@apollo/client'
import { Link } from 'expo-router'
import { Alert, Button, StyleSheet } from 'react-native'

import { ThemedText } from './ThemedText'
import { ThemedView } from './ThemedView'

import { FIND_POSTS_QUERY } from '@/app/(tabs)/admin'

const DELETE_POST_MUTATION = gql`
  mutation DeletePostMutation($id: Int!) {
    deletePost(id: $id) {
      id
    }
  }
`

export interface PostProps {
  post: {
    id: number
    title: string
    body: string
    createdAt: string
    author: { email: string; fullName: string }
  }
}

export function Post({ post }: PostProps) {
  const [deletePost] = useMutation(DELETE_POST_MUTATION, {
    onCompleted: () => {
      Alert.alert('Alert', 'Post deleted')
    },
    onError: (error) => {
      Alert.alert('Alert', error.message)
    },
    // This refetches the query on the list page. Read more about other ways to
    // update the cache over here:
    // https://www.apollographql.com/docs/react/data/mutations/#making-all-other-cache-updates
    refetchQueries: [{ query: FIND_POSTS_QUERY }],
    awaitRefetchQueries: true,
  })

  const onDelete = () => {
    Alert.alert('Alert', `Are you sure you want to delete post ${post.id}?`, [
      { text: 'Cancel' },
      { text: 'OK', onPress: () => deletePost({ variables: { id: post.id } }) },
    ])
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText style={styles.info}>
        {new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(new Date(post.createdAt))}{' '}
        - By: {post.author.fullName}
      </ThemedText>
      <ThemedText type="subtitle">
        {post.id}: {post.title}
      </ThemedText>
      <ThemedText style={styles.info}>ID: {post.id}</ThemedText>
      <ThemedView style={styles.actions}>
        <Link
          href={{
            pathname: '/posts/[id]',
            params: { id: post.id, title: post.title },
          }}
        >
          <ThemedText type="defaultSemiBold" style={styles.show}>
            Show
          </ThemedText>
        </Link>
        <Button color="red" onPress={onDelete} title="Delete" />
      </ThemedView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
    borderColor: '#e5e7eb',
    borderWidth: 1,
  },
  info: {
    fontSize: 14,
    lineHeight: 20,
  },
  show: {
    fontSize: 12,
    lineHeight: 16,
    textTransform: 'uppercase',
    color: '#6b7280',
  },
  actions: {
    display: 'flex',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
})
