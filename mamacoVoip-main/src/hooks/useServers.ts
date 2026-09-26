import { useContext } from 'react'
import { ServersContext } from '../context/ServersContext'

export function useServers() {
  const ctx = useContext(ServersContext)
  if (!ctx) throw new Error('useServers precisa ser usado dentro de um ServersProvider')
  return ctx
}
