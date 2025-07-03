import type { PropsWithChildren } from 'react'
import React from 'react'

import { ScrollView, StyleSheet } from 'react-native'
import Animated, { useAnimatedRef } from 'react-native-reanimated'

import { ThemedView } from '@/components/ThemedView'
import { useBottomTabOverflow } from '@/components/ui/TabBarBackground'

export default function ThemedScrollView({ children }: PropsWithChildren) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>()
  const bottom = useBottomTabOverflow()

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        scrollIndicatorInsets={{ bottom }}
        contentContainerStyle={{ paddingBottom: bottom }}
      >
        <ThemedView style={styles.content}>{children}</ThemedView>
      </ScrollView>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 32,
    gap: 16,
    overflow: 'hidden',
  },
})
