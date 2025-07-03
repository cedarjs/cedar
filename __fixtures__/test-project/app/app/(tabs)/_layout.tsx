import React from 'react'

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Link, Tabs } from 'expo-router'
import { Button, Platform, View } from 'react-native'

import { HapticTab } from '@/components/HapticTab'
import TabBarBackground from '@/components/ui/TabBarBackground'
import { Colors } from '@/constants/Colors'
import { useAuth } from '@/context/auth'
import { useColorScheme } from '@/hooks/useColorScheme'

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const { isAuthenticated, logOut } = useAuth()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            // Use a transparent background on iOS to show the blur effect
            position: 'absolute',
          },
          default: {},
        }),
        headerRight: () => (
          <View style={{ marginRight: 16 }}>
            {isAuthenticated ? (
              <Button onPress={logOut} title="Logout" color="red" />
            ) : (
              <Link href="/modal">Login</Link>
            )}
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Posts',
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="article" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          tabBarIcon: ({ color }) => (
            <MaterialIcons
              name="admin-panel-settings"
              size={28}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  )
}
