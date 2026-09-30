import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { callRpc } from '../../lib/rpcCompat'
import { describeError } from '../../lib/errors'
import { describeMessageContent } from '../../lib/stickers'
import { REPORT_ESCALATION_COLUMN } from '../../hooks/useReports'
import { TabHeader, EmptyState, InlineMessage } from './settingsUI'
import type { Profile, ReportStatus } from '../../types/database'

// "Denúncias da plataforma" — só aparece pra equipe do Mamacos Voip
// (is_app_admin()). Lista as denúncias enviadas à equipe: de DM, de
// grupo, sem servidor, ou de servidor com "enviar também para a equipe".
// O banco (RLS + funções admin_*) é quem garante o acesso.

type PlatformReport = {
  id: string
  reporter_id: string
  server_id: string | null
  target_type: string
  message_id: string | null
  dm_message_id?: string | null
  group_message_id?: string | null
  reported_user_id: string | null
  reason: string
  details: string | null
  content_snapshot?: string | null
  escalated?: boolean
  status: ReportStatus
  created_at: string
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Pendente',
  reviewed: 'Revisada',
  dismissed: 'Descartada',
}

const TARGET_LABEL: Record<string, string> = {
  message: 'Mensagem em servidor',
  dm_message: 'Mensagem direta',
  group_message: 'Mensagem em grupo',
  user: 'Usuário',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function AdminReportsTab() {
  const [reports, setReports] = useState<PlatformReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    let query = supabase
      .from('reports')
      .select('*')
      .or(`${REPORT_ESCALATION_COLUMN}.eq.true,server_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(200)
    if (filter === 'pending') query = query.eq('status', 'pending')
    const { data, error } = await query
    setLoading(false)
    if (error) {
      setError(describeError(error, 'Não foi possível carregar as denúncias.'))
      setReports([])
      return
    }
    setReports((data ?? []) as unknown as PlatformReport[])
  }, [filter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const ids = new Set<string>()
    for (const r of reports) {
      ids.add(r.reporter_id)
      if (r.reported_user_id) ids.add(r.reported_user_id)
    }
    const missing = [...ids].filter((id) => !profiles[id])
    if (missing.length === 0) return
    supabase
      .from('profiles')
      .select('*')
      .in('id', missing)
      .then(({ data }) => {
        if (data) setProfiles((prev) => ({ ...prev, ...Object.fromEntries(data.map((p) => [p.id, p])) }))
      })
  }, [reports, profiles])

  function nameFor(id: string | null) {
    if (!id) return 'usuário removido'
    const p = profiles[id]
    return p ? `${p.display_name || p.username} (@${p.username})` : '...'
  }

  return (
    <div className="space-y-5">
      <TabHeader
        title="Denúncias da plataforma"
        description="Denúncias enviadas à equipe do Mamacos Voip. Visível só para administradores."
      />

      <div className="flex items-center gap-1.5">
        {(['pending', 'all'] as const).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors ${
              filter === f
                ? 'bg-mv-accent/15 border-mv-accent/50 text-white'
                : 'bg-white/[0.02] border-[var(--color-line)] text-mv-muted hover:text-mv-text hover:bg-white/[0.05]'
            }`}
          >
            {f === 'pending' ? 'Pendentes' : 'Todas'}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => void refresh()} className="btn-ghost h-8 px-3 text-[13px]">
          Atualizar
        </button>
      </div>

      {error && <InlineMessage tone="error">{error}</InlineMessage>}

      {loading ? (
        <p className="text-[13px] text-mv-muted" aria-busy="true">
          Carregando...
        </p>
      ) : reports.length === 0 ? (
        <EmptyState icon={<path d="M5 21V4h11l-1.5 4L16 12H5" />} title="Nenhuma denúncia por aqui" />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} nameFor={nameFor} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReportCard({
  report: r,
  nameFor,
  onChanged,
}: {
  report: PlatformReport
  nameFor: (id: string | null) => string
  onChanged: () => void
}) {
  const [context, setContext] = useState<unknown>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState(false)
  const isMessage = r.target_type !== 'user'

  async function loadContext() {
    if (contextOpen) {
      setContextOpen(false)
      return
    }
    setBusy('context')
    setError(null)
    const { data, error, missing } = await callRpc('admin_report_context', { p_report_id: r.id })
    setBusy(null)
    if (error) {
      setError(missing ? 'Função admin_report_context ainda não existe no banco.' : error.message)
      return
    }
    setContext(data)
    setContextOpen(true)
  }

  async function removeMessage() {
    if (!window.confirm('Remover a mensagem denunciada para todos? Isso não pode ser desfeito.')) return
    setBusy('remove')
    setError(null)
    const { error, missing } = await callRpc('admin_remove_reported_message', { p_report_id: r.id })
    setBusy(null)
    if (error) {
      setError(missing ? 'Função admin_remove_reported_message ainda não existe no banco.' : error.message)
      return
    }
    setRemoved(true)
    // A função do banco já marca a denúncia como revisada.
    onChanged()
  }

  async function setStatus(status: ReportStatus) {
    setBusy(status)
    setError(null)
    const { error } = await supabase.from('reports').update({ status }).eq('id', r.id)
    setBusy(null)
    if (error) {
      setError(describeError(error, 'Não foi possível atualizar a denúncia.'))
      return
    }
    onChanged()
  }

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-[var(--color-line)] p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="chip">{TARGET_LABEL[r.target_type] ?? r.target_type}</span>
        <span className={`chip ${r.status === 'pending' ? '!bg-amber-400/12 !text-amber-300 !border-amber-400/25' : ''}`}>
          {STATUS_LABEL[r.status]}
        </span>
        {r.server_id && <span className="chip">Servidor (escalada)</span>}
        <span className="ml-auto text-[11.5px] text-mv-muted">{formatDate(r.created_at)}</span>
      </div>
      <p className="text-[13.5px] text-mv-text break-words">
        <span className="text-mv-muted">Denunciante:</span> {nameFor(r.reporter_id)}
      </p>
      <p className="text-[13.5px] text-mv-text break-words">
        <span className="text-mv-muted">Denunciado:</span> {nameFor(r.reported_user_id)}
      </p>
      <p className="text-[13.5px] text-mv-text mt-1">
        <span className="text-mv-muted">Motivo:</span> {r.reason}
      </p>
      {r.details && <p className="text-[13px] text-mv-muted mt-1 italic break-words">"{r.details}"</p>}
      {r.content_snapshot && !contextOpen && (
        <p className="text-[12.5px] text-mv-muted mt-2 rounded-lg bg-mv-canvas/70 border-l-2 border-rose-500/40 px-3 py-2 line-clamp-4 whitespace-pre-wrap break-words">
          {describeMessageContent(r.content_snapshot)}
        </p>
      )}

      {contextOpen && <ContextView data={context} />}
      {removed && <p className="mt-2 text-[12.5px] text-mv-green">Mensagem removida.</p>}
      {error && (
        <div className="mt-2">
          <InlineMessage tone="error">{error}</InlineMessage>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 mt-3 pt-3 border-t border-[var(--color-line)]">
        <button onClick={loadContext} disabled={!!busy} className="btn-ghost h-8 px-3 text-[13px]">
          {busy === 'context' ? 'Carregando...' : contextOpen ? 'Ocultar contexto' : 'Ver contexto'}
        </button>
        {isMessage && !removed && (
          <button
            onClick={removeMessage}
            disabled={!!busy}
            className="h-8 px-3 rounded-[10px] text-[13px] font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            {busy === 'remove' ? 'Removendo...' : 'Remover mensagem'}
          </button>
        )}
        {r.status === 'pending' && (
          <>
            <button onClick={() => setStatus('dismissed')} disabled={!!busy} className="btn-ghost h-8 px-3 text-[13px]">
              Descartar
            </button>
            <button
              onClick={() => setStatus('reviewed')}
              disabled={!!busy}
              className="h-8 px-3 rounded-[10px] text-[13px] font-medium bg-mv-green/15 text-mv-green border border-mv-green/30 hover:bg-mv-green/25 transition-colors"
            >
              Marcar como revisada
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Formato de admin_report_context (migration 007): uma linha com a
// mensagem denunciada — texto atual, ou o retrato guardado se ela já foi
// apagada (from_snapshot) — e o autor.
type ContextRow = {
  target_type?: string
  server_id?: string | null
  channel_id?: string | null
  dm_conversation_id?: string | null
  group_id?: string | null
  message_id?: string | null
  author_id?: string | null
  author_username?: string | null
  content?: string | null
  message_created_at?: string | null
  from_snapshot?: boolean | null
}

function ContextView({ data }: { data: unknown }) {
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as ContextRow[]
  const row = rows[0]
  if (!row || typeof row !== 'object') {
    return <p className="mt-3 text-[12.5px] text-mv-muted">Sem contexto disponível.</p>
  }
  const where = row.server_id
    ? `servidor ${row.server_id}${row.channel_id ? ` · canal ${row.channel_id}` : ''}`
    : row.dm_conversation_id
      ? `conversa direta ${row.dm_conversation_id}`
      : row.group_id
        ? `grupo ${row.group_id}`
        : null
  return (
    <div className="mt-3 rounded-xl bg-mv-canvas/70 border border-[var(--color-line)] p-3 space-y-1.5 text-[12.5px]">
      <p className="text-mv-muted">
        Autor:{' '}
        <span className="text-mv-text">{row.author_username ? `@${row.author_username}` : (row.author_id ?? 'desconhecido')}</span>
        {row.message_created_at ? ` · ${formatDate(row.message_created_at)}` : ''}
      </p>
      {where && <p className="text-mv-muted break-all">Local: {where}</p>}
      {row.target_type !== 'user' && (
        <>
          <p className="text-mv-text whitespace-pre-wrap break-words">
            {row.content != null ? describeMessageContent(row.content) || '(sem texto — só anexos)' : '(mensagem não encontrada)'}
          </p>
          {row.from_snapshot && (
            <p className="text-[11.5px] text-amber-300">A mensagem já foi apagada — este é o texto guardado no momento da denúncia.</p>
          )}
        </>
      )}
    </div>
  )
}
