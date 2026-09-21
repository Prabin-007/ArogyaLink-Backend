import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './AuthContext'

const SocketContext = createContext(null)

export function SocketProvider({ children }) {
  const { user } = useAuth()
  const [socket, setSocket] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (!user) {
      ref.current?.disconnect()
      ref.current = null
      setSocket(null)
      return
    }
    const s = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001', {
      transports: ['websocket', 'polling']
    })
    ref.current = s
    s.on('connect', () => {
      s.emit('register', { userId: user.id })
      console.log('[Socket] connected as', user.id)
    })
    setSocket(s)
    return () => { s.disconnect(); ref.current = null }
  }, [user?.id])

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
}

export function useSocket() { return useContext(SocketContext) }
