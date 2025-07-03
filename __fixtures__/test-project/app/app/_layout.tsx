import React from 'react'

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from '@react-navigation/native'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import { RedwoodApolloProvider } from '@cedarjs/web/apollo'

import { AuthProvider, useAuth } from '@/context/auth'
import { useColorScheme } from '@/hooks/useColorScheme'

import 'react-native-reanimated'

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  })

  if (!loaded) {
    // Async font loading only occurs in development.
    return null
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RedwoodApolloProvider
          useAuth={useAuth}
          graphQLClientConfig={{ uri: process.env.EXPO_PUBLIC_API_URL! }}
        >
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="+not-found" />
            <Stack.Screen
              name="modal"
              options={{ presentation: 'modal', title: 'Login' }}
            />
          </Stack>
          <StatusBar style="auto" />
        </RedwoodApolloProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
