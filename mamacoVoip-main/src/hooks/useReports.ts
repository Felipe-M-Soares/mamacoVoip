import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { describeError } from '../lib/errors'
import type { Report, ReportStatus, ReportTargetType } from '../types/database'

// Denunciar uma mensagem ou um usuário. server_id/reported_user_id
// reais são recalculados no servidor (ver 012_content_reports.sql) —
// o que mandamos daqui é só a intenção do usuário.
export function useSubmitReport() {
  const { user } = useAuth()

  const submitReport = useCallback(
    async (params: {
      targetType: ReportTargetType
      reason: string
      details?: string
      messageId?: string
      reportedUserId?: string
      serverId?: string
    }) => {
      if (!user) return { error: 'Não autenticado' }
      const { error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        target_type: params.targetType,
        reason: params.reason,
        details: params.details?.trim() || undefined,
        message_id: params.messageId,
        reported_user_id: params.reportedUserId,
        server_id: params.serverId,
      })
      if (error) return { error: describeError(error, 'Não foi possível enviar a denúncia') }
      return { error: null }
    },
    [user]
  )

  return { submitReport }
}

// Lista de denúncias de UM servidor, pra quem modera aquele servidor
// (dono, ou quem tem a permissão manage_messages — a policy de SELECT
// no banco já garante isso, aqui só refletimos o que voltar).
export function useServerReports(serverId: string | null) {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!serverId) {
      setReports([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('server_id', serverId)
      .order('created_at', { ascending: false })
      .limit(200)
    setReports(data ?? [])
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    refresh()
    if (!serverId) return
    const channel = supabase
      .channel(`reports:${serverId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reports', filter: `server_id=eq.${serverId}` },
        () => refresh()
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [serverId, refresh])

  const setStatus = useCallback(async (reportId: string, status: ReportStatus) => {
    const { error } = await supabase.from('reports').update({ status }).eq('id', reportId)
    if (error) return { error: describeError(error, 'Não foi possível atualizar a denúncia') }
    return { error: null }
  }, [])

  const pendingCount = reports.filter((r) => r.status === 'pending').length

  return { reports, loading, refresh, setStatus, pendingCount }
}
