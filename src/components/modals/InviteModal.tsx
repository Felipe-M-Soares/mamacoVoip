import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useServers } from "../../hooks/useServers";
import { useAuth } from "../../hooks/useAuth";
import { isElectron } from "../../hooks/useGamePresence";
import { PUBLIC_WEB_URL } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import type { ServerInvite } from "../../types/database";

// Dentro do app desktop, window.location.origin não é uma URL de
// verdade (é o protocolo interno do Electron) — ver o comentário em
// lib/config.ts. Fora dele (no navegador), window.location.origin já
// reflete o domínio certo sozinho, inclusive em previews/domínios
// customizados.
function inviteBaseUrl(): string {
  return isElectron() ? PUBLIC_WEB_URL : window.location.origin;
}

// Validade em horas (null = nunca expira — o create_server_invite do
// banco já aceita p_expires_hours nulo).
const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "1 dia", hours: 24 },
  { label: "7 dias", hours: 24 * 7 },
  { label: "30 dias", hours: 24 * 30 },
  { label: "Nunca expira", hours: null },
];
const MAX_USES_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Sem limite", value: null },
  { label: "1 uso", value: 1 },
  { label: "5 usos", value: 5 },
  { label: "10 usos", value: 10 },
  { label: "25 usos", value: 25 },
  { label: "100 usos", value: 100 },
];

function describeInvite(inv: ServerInvite): string {
  const parts: string[] = [];
  parts.push(
    inv.expires_at
      ? `expira em ${new Date(inv.expires_at).toLocaleDateString("pt-BR")}`
      : "nunca expira",
  );
  parts.push(
    inv.max_uses
      ? `${inv.uses}/${inv.max_uses} usos`
      : `${inv.uses} ${inv.uses === 1 ? "uso" : "usos"}`,
  );
  return parts.join(" · ");
}

export function InviteModal({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const { createInvite, servers } = useServers();
  const { user } = useAuth();
  const isOwner = servers.find((s) => s.id === serverId)?.owner_id === user?.id;
  const [expiryIdx, setExpiryIdx] = useState(1);
  const [maxUsesIdx, setMaxUsesIdx] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<ServerInvite[]>([]);

  // Convites ATIVOS que a pessoa pode revogar (RLS de delete: quem criou
  // ou o dono do servidor). Importante agora que dá pra criar convite
  // permanente: um link vazado precisa poder ser desligado.
  const loadInvites = useCallback(async () => {
    if (!user) return;
    let q = supabase
      .from("server_invites")
      .select("*")
      .eq("server_id", serverId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (!isOwner) q = q.eq("created_by", user.id);
    const { data } = await q;
    const now = Date.now();
    setInvites(
      ((data ?? []) as ServerInvite[]).filter(
        (i) =>
          (!i.expires_at || new Date(i.expires_at).getTime() > now) &&
          (!i.max_uses || i.uses < i.max_uses),
      ),
    );
  }, [serverId, user, isOwner]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    const { error, invite } = await createInvite(
      serverId,
      MAX_USES_OPTIONS[maxUsesIdx].value ?? undefined,
      EXPIRY_OPTIONS[expiryIdx].hours ?? undefined,
    );
    setLoading(false);
    if (error || !invite) {
      setError(
        error && /demais|aguarde|espere/i.test(error)
          ? error
          : "Não foi possível gerar o convite.",
      );
      return;
    }
    setLink(`${inviteBaseUrl()}/convite/${invite.code}`);
    void loadInvites();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 2000);
    } catch {
      setError(
        "Não foi possível copiar. Selecione o link e copie manualmente.",
      );
    }
  }

  async function revoke(id: string) {
    const { error } = await supabase
      .from("server_invites")
      .delete()
      .eq("id", id);
    if (error) {
      setError("Não foi possível revogar o convite.");
      return;
    }
    setInvites((list) => list.filter((i) => i.id !== id));
    const revoked = invites.find((i) => i.id === id);
    if (revoked && link?.endsWith(`/convite/${revoked.code}`)) setLink(null);
  }

  const selectClass =
    "w-full h-10 px-3 rounded-xl bg-mv-canvas border border-[var(--color-line-strong)] text-sm text-mv-text";

  return (
    <Modal
      title="Convidar amigos"
      description="Escolha a validade e compartilhe o link para convidar pessoas ao servidor."
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label htmlFor="invite-expiry" className="field-label">
            Expira em
          </label>
          <select
            id="invite-expiry"
            value={expiryIdx}
            onChange={(e) => {
              setExpiryIdx(Number(e.target.value));
              setLink(null);
            }}
            className={selectClass}
          >
            {EXPIRY_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="invite-uses" className="field-label">
            Limite de usos
          </label>
          <select
            id="invite-uses"
            value={maxUsesIdx}
            onChange={(e) => {
              setMaxUsesIdx(Number(e.target.value));
              setLink(null);
            }}
            className={selectClass}
          >
            {MAX_USES_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!link ? (
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full h-10 btn-primary text-sm"
        >
          {loading ? "Gerando..." : "Gerar link de convite"}
        </button>
      ) : (
        <div>
          <label htmlFor="invite-link" className="field-label">
            Link de convite
          </label>
          <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-mv-canvas border border-[var(--color-line-strong)]">
            <input
              id="invite-link"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
              style={{ boxShadow: "none" }}
              className="flex-1 min-w-0 px-2 bg-transparent text-mv-text outline-none text-sm font-mono"
            />
            <button
              onClick={() => void copy(link)}
              className={`h-8 px-4 text-sm shrink-0 ${copied === link ? "rounded-[10px] font-semibold bg-mv-green text-white" : "btn-primary"}`}
            >
              {copied === link ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-mv-muted mt-2">
            {EXPIRY_OPTIONS[expiryIdx].hours === null
              ? "Este link não expira. Você pode revogá-lo a qualquer momento abaixo."
              : `Este link expira em ${EXPIRY_OPTIONS[expiryIdx].label}.`}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-rose-400 mt-3">{error}</p>}

      {invites.length > 0 && (
        <div className="mt-5">
          <p className="field-label">
            {isOwner ? "Convites ativos do servidor" : "Seus convites ativos"}
          </p>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {invites.map((inv) => {
              const url = `${inviteBaseUrl()}/convite/${inv.code}`;
              return (
                <li
                  key={inv.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-mv-canvas border border-[var(--color-line)]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-mv-text truncate">
                      {inv.code}
                    </p>
                    <p className="text-xs text-mv-muted">
                      {describeInvite(inv)}
                    </p>
                  </div>
                  <button
                    onClick={() => void copy(url)}
                    className="btn-ghost h-8 px-3 text-xs shrink-0"
                  >
                    {copied === url ? "Copiado!" : "Copiar"}
                  </button>
                  <button
                    onClick={() => void revoke(inv.id)}
                    className="btn-danger h-8 px-3 text-xs shrink-0"
                  >
                    Revogar
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
