import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { changesChannel } from '../lib/realtimeChannel'
import { useAuth } from './useAuth'
import { describeError } from '../lib/errors'
import { isMissingDbObject } from '../lib/rpcCompat'
import type { Report, ReportStatus, ReportTargetType } from '../types/database'

// Coluna que marca a denúncia como enviada também pra equipe da
// plataforma (migration 007).
export const REPORT_ESCALATION_COLUMN = 'escalated'

// Denunciar uma mensagem (de servidor, DM ou grupo) ou um usuário.
// server_id/reported_user_id reais são recalculados no servidor (ver
// set_report_context no banco) — o que mandamos daqui é só a intenção.
//
// Denúncias de DM/grupo e as sem servidor vão pra equipe do Mamacos Voip
// (não existe moderação de servidor pra elas); numa denúncia de
// servidor, `escalate` pede que a equipe também veja.
export type SubmitReportTarget = ReportTargetType | 'dm_message' | 'group_message'

export function useSubmitReport() {
  const { user } = useAuth()

  const submitReport = useCallback(
    async (params: {
      targetType: SubmitReportTarget
      reason: string
      details?: string
      messageId?: string
      dmMessageId?: string
      groupMessageId?: string
      reportedUserId?: string
      serverId?: string
      escalate?: boolean
    }) => {
      if (!user) return { error: 'Não autenticado' }
      const reason = params.reason.trim()
      if (!reason) return { error: 'Escolha um motivo pra denúncia.' }
      if (reason.length > 100) return { error: 'Motivo longo demais.' }
      const details = params.details?.trim()
      if (details && details.length > 1000) return { error: 'Os detalhes podem ter no máximo 1000 caracteres.' }
      const isPlatformTarget = params.targetType === 'dm_message' || params.targetType === 'group_message' || !params.serverId
      const row: Record<string, unknown> = {
        reporter_id: user.id,
        target_type: params.targetType,
        reason,
        details: details || undefined,
        message_id: params.messageId,
        reported_user_id: params.reportedUserId,
        server_id: params.serverId,
      }
      if (params.dmMessageId) row.dm_message_id = params.dmMessageId
      if (params.groupMessageId) row.group_message_id = params.groupMessageId
      const escalate = isPlatformTarget || !!params.escalate
      if (escalate) row[REPORT_ESCALATION_COLUMN] = true
      let { error } = await supabase.from('reports').insert(row as never)
      // Banco ainda sem a coluna de escalonamento: denúncia de servidor
      // segue sem ela (a moderação do servidor ainda recebe).
      if (error && escalate && !isPlatformTarget && isMissingDbObject(error)) {
        delete row[REPORT_ESCALATION_COLUMN]
        ;({ error } = await supabase.from('reports').insert(row as never))
      }
      if (error) {
        if (isMissingDbObject(error) || /target_type/i.test(error.message)) {
          return { error: 'Denúncia de conversas ainda não está disponível. Tente de novo mais tarde.' }
        }
        return { error: describeError(error, 'Não foi possível enviar a denúncia') }
      }
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
    const channel = changesChannel(`reports:${serverId}`)
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
