# Notificações no celular (Android)

O app Android avisa quando chega:
- **mensagem direta** (se ninguém bloqueou ninguém);
- **mensagem em grupo**;
- **menção** em canal de servidor (`@seunome`) — respeita "silenciar canal" e
  nunca avisa de canal restrito.

Usa o **Firebase Cloud Messaging** (Google), que é grátis.

## Configurar (uma vez só)

### 1. Criar o projeto no Firebase
1. Entre em **console.firebase.google.com** → **Criar projeto** → nome
   `Mamacos Voip` (pode desligar o Google Analytics).
2. Na página do projeto, clique no ícone do **Android** ("Adicionar app").
3. **Nome do pacote:** `com.mamacosvoip.app` (exatamente assim) →
   **Registrar app**.
4. Baixe o **google-services.json**. Pode pular os outros passos do
   assistente.

### 2. GitHub (pro APK sair com notificações)
**Settings → Secrets and variables → Actions → New repository secret**

| Nome | Valor |
|---|---|
| `GOOGLE_SERVICES_JSON` | abra o google-services.json no Bloco de Notas, copie TUDO e cole |

### 3. Chave do servidor (pro Supabase mandar as notificações)
1. No Firebase: ⚙ **Configurações do projeto → Contas de serviço →
   Gerar nova chave privada** → baixa um arquivo `.json`.
2. Supabase → **Edge Functions → Secrets → Add new secret**:

| Nome | Valor |
|---|---|
| `FCM_SERVICE_ACCOUNT` | abra o .json no Bloco de Notas, copie TUDO e cole |

Guarde esse arquivo num lugar seguro e apague dos Downloads — ele dá
acesso a mandar notificações pelo seu projeto.

### 4. Banco e função
1. Rode o **007** atualizado no SQL Editor (PARTE 29).
2. GitHub → **Actions → Publicar funções do Supabase (GIFs e notificações)
   → Run workflow**.
3. Gere um APK novo (o próximo push já gera) e instale/atualize no celular.

Ao abrir o app, o Android pergunta se pode mostrar notificações → **Permitir**.

## Não chegou notificação?
- Configurações do Android → Apps → Mamacos Voip → Notificações: ligadas?
- Supabase → Edge Functions → **push-notify → Logs**: mande um print.
