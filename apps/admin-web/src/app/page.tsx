'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isRootToken } from '@/lib/auth'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    const token = localStorage.getItem('root_token')
    router.replace(isRootToken(token) ? '/dashboard' : '/login')
  }, [])
  return null
}
