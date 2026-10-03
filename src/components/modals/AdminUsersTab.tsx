import { useCallback, useEffect, useRef, useState } from 'react'
import { callRpc } from '../../lib/rpcCompat'
import { describeError } from '../../lib/errors'
import { copyText } from '../../lib/copyText'
import { Avatar } from '../ui/Avatar'
import { TabHeader, SettingsCard, InlineMessage } from './settingsUI'

// "Usuários" — só pra quem administra a plataforma (app_admins + 2FA).
// Privacidade: o banco devolve o e-mail MASCARADO; ver o completo é uma
// ação à parte, registrada no log de auditoria. Nada de mensagens/DMs.

type AdminUser = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  email_masked: string | null
  provider: string
  created_at: string
  last_sign_in_at: string | null
  email_confirmed: boolean
  plan: string
  plan_expires_at: string | null
  plan_note: string | null
  server_count: number
  total_count: number
}

type Stats = { total: number; new_7d: number; new_30d: number; active_7d: number; paid: number }

const PAGE = 50

// Planos conhecidos (dá pra criar outros nomes no futuro sem mexer no banco).
const PLANS: { id: string; label: string }[] = [
  { id: 'free', label: 'Grátis' },
  { id: 'premium', label: 'Premium' },
]

function planLabel(plan: string) {
  return PLANS.find((p) => p.id === plan)?.label ?? plan
}

function providerLabel(p: string) {
  if (p === 'google') return 'Google'
  if (p === 'email') return 'E-mail'
  return p
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtRelative(iso: string | null) {
  if (!iso) return 'nunca'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 60) return min <= 1 ? 'agora' : `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return `há ${d} ${d === 1 ? 'dia' : 'dias'}`
  return fmtDate(iso)
}

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-[0.06em] text-mv-muted">{label}</p>
      <p className="font-display text-[22px] font-semibold text-white tabular-nums mt-0.5">
        {value === undefined ? '—' : value.toLocaleString('pt-BR')}
      </p>
    </div>
  )
}

export function AdminUsersTab() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const searchTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [statsRes, listRes] = await Promise.all([
      callRpc<Stats>('admin_user_stats'),
      callRpc<AdminUser[]>('admin_list_users', {
        p_search: query || null,
        p_plan: planFilter || null,
        p_limit: PAGE,
        p_offset: page * PAGE,
      }),
    ])
    setLoading(false)
    if (listRes.missing || statsRes.missing) {
      setError('O banco ainda não tem o painel de usuários. Rode o arquivo 007 de novo no SQL Editor do Supabase.')
      return
    }
    if (listRes.error) {
      setError(describeError(listRes.error, 'Não foi possível carregar os usuários.'))
      return
    }
    if (statsRes.data) setStats(statsRes.data)
    const rows = listRes.data ?? []
    setUsers(rows)
    setTotal(rows[0]?.total_count ?? 0)
  }, [query, planFilter, page])

  useEffect(() => {
    void load()
  }, [load])

  function onSearchChange(v: string) {
    setSearch(v)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      setPage(0)
      setQuery(v.trim())
    }, 350)
  }

  async function reveal(u: AdminUser) {
    if (revealed[u.id]) return
    if (!confirm('Mostrar o e-mail completo dessa conta? Essa ação fica registrada no log de administração.')) return
    const { data, error: err } = await callRpc<string>('admin_reveal_email', { p_user_id: u.id })
    if (err) {
      setError(describeError(err, 'Não foi possível mostrar o e-mail.'))
      return
    }
    if (data) setRevealed((r) => ({ ...r, [u.id]: data }))
  }

  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="space-y-5">
      <TabHeader
        title="Usuários"
        description="Todas as contas do Mamacos Voip. Só administradores da plataforma veem esta tela. E-mails aparecem mascarados, e ver um completo ou mudar um plano fica registrado."
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatTile label="Contas" value={stats?.total} />
        <StatTile label="Novas 7d" value={stats?.new_7d} />
        <StatTile label="Novas 30d" value={stats?.new_30d} />
        <StatTile label="Ativas 7d" value={stats?.active_7d} />
        <StatTile label="Pagantes" value={stats?.paid} />
      </div>

      <SettingsCard title="Contas">
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nome, @usuário ou e-mail completo"
            aria-label="Buscar usuários"
            className="flex-1 h-10 px-3 bg-mv-canvas text-mv-text text-[13.5px] outline-none"
          />
          <select
            value={planFilter}
            onChange={(e) => {
              setPage(0)
              setPlanFilter(e.target.value)
            }}
            aria-label="Filtrar por plano"
            className="h-10 px-3 bg-mv-canvas text-mv-text text-[13.5px] outline-none sm:w-40"
          >
            <option value="">Todos os planos</option>
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {error && <InlineMessage tone="error">{error}</InlineMessage>}

        {loading && users.length === 0 ? (
          <p className="text-[13px] text-mv-muted py-6 text-center">Carregando…</p>
        ) : users.length === 0 && !error ? (
          <p className="text-[13px] text-mv-muted py-6 text-center">Nenhuma conta encontrada.</p>
        ) : (
          <div className={`divide-y divide-[var(--color-line)] ${loading ? 'opacity-60' : ''}`}>
            {users.map((u) => {
              const name = u.display_name || u.username || 'Sem perfil'
              const paid = u.plan !== 'free'
              return (
                <div key={u.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={u.username ?? name} avatarUrl={u.avatar_url} userId={u.id} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13.5px] font-medium text-white truncate">{name}</span>
                      {u.username && <span className="text-[12px] text-mv-muted truncate">@{u.username}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-mv-muted mt-0.5">
                      <button
                        type="button"
                        onClick={() => (revealed[u.id] ? void copyText(revealed[u.id]) : void reveal(u))}
                        className="hover:text-white tabular-nums"
                        title={revealed[u.id] ? 'Copiar e-mail' : 'Mostrar e-mail completo (fica registrado)'}
                      >
                        {revealed[u.id] ?? u.email_masked ?? 'sem e-mail'}
                      </button>
                      <span aria-hidden>·</span>
                      <span>{providerLabel(u.provider)}</span>
                      {!u.email_confirmed && u.provider === 'email' && (
                        <span className="text-amber-300">e-mail não confirmado</span>
                      )}
                      <span aria-hidden>·</span>
                      <span title={`Conta criada em ${fmtDate(u.created_at)}`}>desde {fmtDate(u.created_at)}</span>
                      <span aria-hidden>·</span>
                      <span>último acesso {fmtRelative(u.last_sign_in_at)}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {u.server_count} {u.server_count === 1 ? 'servidor' : 'servidores'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(u)}
                    className={`shrink-0 h-7 px-2.5 rounded-full text-[11.5px] font-semibold border transition-colors ${
                      paid
                        ? 'border-mv-accent/40 bg-mv-accent/15 text-white hover:bg-mv-accent/25'
                        : 'border-[var(--color-line-strong)] text-mv-muted hover:text-white hover:bg-white/[0.05]'
                    }`}
                    title="Mudar plano"
                  >
                    {planLabel(u.plan)}
                    {u.plan_expires_at && paid ? ` · até ${fmtDate(u.plan_expires_at)}` : ''}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between mt-3 text-[12.5px] text-mv-muted">
          <span>
            {total.toLocaleString('pt-BR')} {total === 1 ? 'conta' : 'contas'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => p - 1)}
              className="h-8 px-3 btn-secondary text-[12.5px] disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="tabular-nums">
              {page + 1}/{pages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="h-8 px-3 btn-secondary text-[12.5px] disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      </SettingsCard>

      {editing && (
        <PlanEditor
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function PlanEditor({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState(user.plan)
  const [expires, setExpires] = useState(user.plan_expires_at ? user.plan_expires_at.slice(0, 10) : '')
  const [note, setNote] = useState(user.plan_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = user.display_name || user.username || 'conta'

  async function save() {
    setSaving(true)
    setError(null)
    const { error: err } = await callRpc('admin_set_user_plan', {
      p_user_id: user.id,
      p_plan: plan,
      // Fim do dia escolhido, no horário local.
      p_expires_at: plan !== 'free' && expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      p_note: plan !== 'free' ? note : null,
    })
    setSaving(false)
    if (err) setError(describeError(err, 'Não foi possível salvar o plano.'))
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-[600] bg-black/60 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Plano de ${name}`}
        className="surface-elevated rounded-2xl p-5 w-full max-w-sm"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-[17px] font-semibold text-white">Plano de {name}</h2>
        <p className="text-[12.5px] text-mv-muted mt-1">A mudança fica registrada no log de administração.</p>

        <label className="field-label mt-4 block">Plano</label>
        <div className="flex gap-2">
          {PLANS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlan(p.id)}
              className={`flex-1 h-10 rounded-lg border text-[13.5px] font-medium transition-colors ${
                plan === p.id
                  ? 'border-mv-accent bg-mv-accent/15 text-white'
                  : 'border-[var(--color-line-strong)] text-mv-muted hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {plan !== 'free' && (
          <>
            <label className="field-label mt-4 block" htmlFor="plan-expires">
              Válido até (vazio = sem data de fim)
            </label>
            <input
              id="plan-expires"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="w-full h-10 px-3 bg-mv-canvas text-mv-text text-[13.5px] outline-none"
            />
            <label className="field-label mt-4 block" htmlFor="plan-note">
              Observação (só admins veem)
            </label>
            <input
              id="plan-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: pagou via Pix em 01/10"
              className="w-full h-10 px-3 bg-mv-canvas text-mv-text text-[13.5px] outline-none"
            />
          </>
        )}

        {error && (
          <div className="mt-3">
            <InlineMessage tone="error">{error}</InlineMessage>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="h-9 px-4 btn-secondary text-[13px]">
            Cancelar
          </button>
          <button type="button" disabled={saving} onClick={() => void save()} className="h-9 px-4 btn-primary text-[13px]">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
