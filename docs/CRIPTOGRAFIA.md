# O que é criptografado no Mamacos Voip

| Dado | Onde fica | Proteção |
|---|---|---|
| Tudo que trafega (chat, login, arquivos, API) | Internet | HTTPS/TLS 1.2+ |
| Voz, vídeo e transmissões | Servidor de voz (Oracle) | DTLS-SRTP (WebRTC) ponta a servidor; conexão de sinalização por WSS |
| Banco de dados (mensagens, contas, servidores) | Supabase | AES-256 em disco (padrão do Supabase) + regras de acesso por linha (RLS) |
| Anexos (fotos, vídeos, arquivos) | Supabase Storage | AES-256 em disco, buckets privados, só abre por link temporário |
| Senhas | Supabase Auth | Hash bcrypt (nunca guardadas em texto) |
| Cópias de segurança | GitHub (Artifacts, 90 dias) | AES-256 com a sua `BACKUP_PASSWORD` (ver BACKUP.md) |
| Sessão de login no PC | Pasta do app | Cofre do sistema (DPAPI no Windows / Keychain no Mac) |
| Notas privadas sobre usuários no PC | Pasta do app | Cofre do sistema (o mesmo da sessão) |
| Clipes de transmissão | Só na memória, depois na sua pasta Downloads | Não saem do seu PC |
| Chave do APK Android | Secrets do GitHub | Cifrada pelo GitHub; o arquivo .p12 também tem senha |

## O que NÃO é ponta a ponta

As mensagens ficam legíveis para o servidor (é o que permite busca, histórico em vários aparelhos,
moderação e denúncias — igual Discord). O servidor de voz também decifra o áudio/vídeo para
redistribuir (é um SFU; só repassa, não grava). Criptografia ponta a ponta exigiria abrir mão
desses recursos.

## Chaves e senhas que só você tem

- `BACKUP_PASSWORD` — abre os backups.
- `ANDROID_KEYSTORE_PASSWORD` + o `.txt` da chave — assinam o APK.
- `SUPABASE_SERVICE_ROLE_KEY`, chave/segredo do LiveKit — só nos Secrets do GitHub/Supabase.

Nunca coloque nenhuma delas no código (o repositório é público).
