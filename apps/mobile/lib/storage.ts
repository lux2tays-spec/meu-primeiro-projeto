import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem('token')
  }
  return SecureStore.getItemAsync('token')
}

export async function setToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem('token', token)
    return
  }
  await SecureStore.setItemAsync('token', token)
}

export async function deleteToken(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem('token')
    return
  }
  await SecureStore.deleteItemAsync('token')
}
