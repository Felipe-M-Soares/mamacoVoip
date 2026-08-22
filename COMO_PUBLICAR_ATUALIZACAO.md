# Como publicar uma atualização (auto-update)

## Por que o auto-update estava dando erro 404 no "latest.yml"

O `package.json` já tinha a configuração de publicação (`build.publish`) apontando
pro GitHub certo. O problema é que até agora as versões estavam sendo geradas com:

```
npm run electron:build
```

Esse comando **só gera os arquivos localmente** (na pasta `release/`) — ele nunca
sobe nada pro GitHub, e nunca gera o `latest.yml` (o "manifesto" que o app usa pra
saber se existe uma versão mais nova). Subir manualmente só o `.exe` numa Release do
GitHub nunca vai gerar esse arquivo — só o `electron-builder` sabe gerá-lo, e só
quando roda em modo "publish".

## O jeito certo, a partir de agora

Foi adicionado um novo comando: `npm run release`. Ele faz o build **e** publica
automaticamente uma nova Release no GitHub, com o instalador **e** o `latest.yml`
já anexados — depois disso, o auto-update dentro do app passa a funcionar sozinho
pra sempre, sem precisar mandar nada manualmente pros usuários de novo.

### Passo a passo

1. Gere um token do GitHub (uma vez só, guarde ele num lugar seguro):
   - Acesse https://github.com/settings/tokens → "Generate new token (classic)"
   - Marque o escopo `repo` (acesso completo ao repositório)
   - Copie o token gerado (só aparece uma vez)

2. Antes de publicar, defina o token como variável de ambiente no terminal:
   - Windows (PowerShell): `$env:GH_TOKEN = "seu_token_aqui"`
   - Windows (cmd): `set GH_TOKEN=seu_token_aqui`
   - Mac/Linux: `export GH_TOKEN=seu_token_aqui`

3. Suba a versão no `package.json` (campo `"version"`, ex: `1.0.0` → `1.0.1`) —
   o electron-updater usa esse número pra saber que existe algo mais novo.

4. Rode:
   ```
   npm run release
   ```

   Isso cria automaticamente uma Release no GitHub (como rascunho, por padrão) com
   o instalador e o `latest.yml`. Só falta ir em
   https://github.com/Felipe-M-Soares/mamacoVoip/releases, abrir o rascunho e
   clicar em "Publish release".

5. Pronto. Quem já tem o app instalado recebe a atualização sozinho (o app já
   confere por conta própria, na abertura e a cada 30 minutos). Ninguém precisa
   baixar o instalador de novo manualmente — só a primeira pessoa que ainda não
   tem o app instalado.

### Resumo

- `npm run electron:build` → só testar localmente, não publica nada.
- `npm run release` → o comando de verdade pra lançar uma versão nova pros usuários.
