import { useContext } from 'react'
import { ChannelsContext } from '../context/ChannelsContext'

export function useChannels() {
  const ctx = useContext(ChannelsContext)
  if (!ctx) throw new Error('useChannels precisa ser usado dentro de um ChannelsProvider')
  return ctx
}
