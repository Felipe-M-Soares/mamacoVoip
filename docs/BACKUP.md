# Backup do banco de dados

Todo domingo o GitHub gera sozinho uma cópia do banco do Supabase
(workflow **"Backup do banco (criptografado)"**). A cópia sai criptografada
com AES-256 usando a senha do secret `BACKUP_PASSWORD` — sem essa senha o
arquivo não abre. Cada cópia fica guardada por 90 dias.

## Configurar (uma vez só)

No GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Nome | Valor |
|---|---|
| `SUPABASE_DB_URL` | Supabase → **Project Settings → Database → Connection string** → aba **Session pooler** → copie a URI e troque `[YOUR-PASSWORD]` pela senha do banco |
| `BACKUP_PASSWORD` | Uma senha forte criada por você (12+ caracteres). **Anote num lugar seguro** — sem ela o backup não abre. |

Para testar sem esperar o domingo: **Actions → Backup do banco (criptografado) → Run workflow**.

## Onde ficam os backups

**Actions → Backup do banco (criptografado)** → clique numa execução →
seção **Artifacts** → `mamacos-backup-AAAA-MM-DD`.

## Restaurar (só em emergência)

Precisa de um computador com `openssl` e Postgres 17 (`pg_restore`).

```bash
# 1. Descriptografar (pede a BACKUP_PASSWORD)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in mamacos-backup-AAAA-MM-DD.dump.enc -out backup.dump

# 2. Restaurar num projeto Supabase (use a connection string dele)
pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "postgresql://...session-pooler..." backup.dump
```

O que **não** entra no backup: os arquivos enviados no chat (fotos,
vídeos, áudios) — só os registros deles. Apague o `backup.dump`
descriptografado depois de usar.
