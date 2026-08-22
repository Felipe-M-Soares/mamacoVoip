# Como publicar uma atualização (sem terminal, só GitHub Desktop)

## Boa notícia: você não precisa rodar nenhum comando

O projeto já tem um "robô" configurado (`.github/workflows/release-desktop.yml`) que
faz TUDO sozinho, automaticamente, toda vez que você manda uma alteração pro GitHub
pelo GitHub Desktop normalmente (o mesmo botão "Push origin" que você já usa). Ele:

1. Calcula um número de versão novo sozinho.
2. Builda o app pra Windows, Mac e Linux.
3. Publica uma Release no GitHub já com o instalador **e** o arquivo de atualização
   (`latest.yml`) anexados.

Ou seja: você só precisa continuar usando o GitHub Desktop do jeito que já usa
(Commit → Push origin). Nada de terminal, nada de token, nada de comando.

## Por que o erro "latest.yml 404" ainda apareceu, então

Esse robô (workflow) foi adicionado ao projeto, mas pra ele começar a funcionar
**precisa rodar pelo menos uma vez com sucesso**. Se isso ainda não aconteceu (ou
rodou e falhou por falta de uma permissão), o GitHub nunca teve uma Release com
`latest.yml` publicada — e é exatamente isso que causa o erro que você viu.

## Checklist pra garantir que vai funcionar (tudo pelo navegador, sem terminal)

1. **Confirme que o robô já rodou.** No site do GitHub, entre no seu repositório →
   aba **Actions** (no menu de cima, ao lado de "Pull requests"). Você deve ver uma
   lista de execuções chamadas "Build e publicar app desktop". Se tiver uma com um
   ✅ verde, deu certo. Se tiver um ❌ vermelho, clique nela pra ver qual passo
   falhou (me manda um print se aparecer erro, que eu leio e te digo o que fazer).
   Se a lista estiver **vazia**, é porque o push com esse arquivo novo (que está no
   zip que te mandei) ainda não chegou no GitHub — faça o Commit + Push desse zip
   pelo GitHub Desktop primeiro.

2. **Permissão de escrita do robô.** No repositório → **Settings** → **Actions** →
   **General** → role até "Workflow permissions". Precisa estar marcado
   **"Read and write permissions"** (não "Read repository contents permission").
   Sem isso, o robô não consegue criar a Release e falha silenciosamente. Marque
   essa opção e clique em "Save" se ainda não estiver assim.

3. **As variáveis de ambiente do app (Supabase/TURN).** No repositório →
   **Settings** → **Secrets and variables** → **Actions** → **Repository secrets**.
   Precisa existir um secret pra cada uma dessas (com os MESMOS valores que você já
   usa na Vercel):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_TURN_URL`
   - `VITE_TURN_USERNAME`
   - `VITE_TURN_CREDENTIAL`

   Se algum estiver faltando, o app builda mas fica com tela preta pra quem
   instalar — vale conferir mesmo que o erro atual seja só sobre atualização.

4. Depois de conferir os itens 2 e 3, é só fazer qualquer Commit + Push pelo GitHub
   Desktop de novo (pode ser até uma mudança pequena) pra disparar o robô mais uma
   vez. Acompanhe na aba **Actions** até aparecer o ✅ verde.

## A partir daí

Todo Push que você fizer pelo GitHub Desktop publica uma versão nova sozinho, e
quem já tem o app instalado recebe a atualização automaticamente (o app confere
sozinho ao abrir, e a cada 30 minutos enquanto estiver aberto). Ninguém mais
precisa baixar o instalador manualmente de novo — só quem ainda não tem o app.
