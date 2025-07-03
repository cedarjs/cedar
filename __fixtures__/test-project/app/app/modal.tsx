import React, { useEffect, useState } from 'react'

import { useRouter } from 'expo-router'
import { Alert, Button, StyleSheet, TextInput } from 'react-native'

import { ThemedView } from '@/components/ThemedView'
import { useAuth } from '@/context/auth'

export default function Modal() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { isAuthenticated, logIn } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated && router.canGoBack()) {
      router.push('../')
    }
  }, [isAuthenticated])

  const onLogin = async () => {
    if (!username || !password) {
      Alert.alert('Alert', `Both username and password are required`)
      return
    }

    const response = await logIn({ username, password })

    if (response.message) {
      Alert.alert('Alert', response.message)
    } else if (response.error) {
      Alert.alert('Alert', response.error)
    }
  }

  return (
    <ThemedView style={styles.container}>
      <TextInput
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        style={styles.input}
        autoCapitalize="none"
      />

      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        style={styles.input}
        secureTextEntry
      />

      <Button title="Login" onPress={onLogin} />
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 12,
    marginBottom: 16,
    borderRadius: 6,
  },
})
