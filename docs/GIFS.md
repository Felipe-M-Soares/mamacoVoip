# GIFs no chat (KLIPY)

A busca de GIFs usa o **KLIPY** (grátis). A chave fica só no servidor do
Supabase — o app nunca vê a chave, e o KLIPY não recebe nome, e-mail nem IP
de quem pesquisa (só um código anônimo).

## Configurar (uma vez só)

### 1. Criar a chave no KLIPY
1. Entre em **partner.klipy.com** e crie a conta.
2. Crie um app (nome: `Mamacos Voip`, plataforma Web) e copie a **API key**.

### 2. Guardar a chave no Supabase
Supabase → **Edge Functions → Secrets** (ou Project Settings → Edge
Functions) → **Add new secret**:

| Nome | Valor |
|---|---|
| `KLIPY_API_KEY` | a chave do KLIPY |

### 3. Publicar a função (pelo GitHub, sem instalar nada)
GitHub → **Settings → Secrets and variables → Actions**:

| Nome | Valor |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens → **Generate new token** |
| `SUPABASE_PROJECT_REF` | o código do projeto que aparece na URL do painel do Supabase (`.../project/ESTE-CÓDIGO`) |

Depois: **Actions → Publicar funções do Supabase (GIFs) → Run workflow**.

Pronto — o botão GIF do chat já busca no KLIPY. O secret antigo
`VITE_GIPHY_API_KEY` pode ser apagado do GitHub e da Vercel.
