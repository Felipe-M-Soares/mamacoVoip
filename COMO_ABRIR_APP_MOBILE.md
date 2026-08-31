# Como abrir e testar o app mobile (Android)

## O que já está pronto

O projeto agora tem uma pasta `android/` — é um app Android de verdade
(gerado com o Capacitor), que reaproveita 100% da interface React que já
existe. Ele **não substitui nada** do app de desktop: os dois continuam
existindo separados, no mesmo repositório.

**Importante sobre iOS:** só dá pra gerar/abrir o projeto iOS (`ios/`) numa
máquina Mac com Xcode instalado — é uma exigência da própria Apple, não
uma limitação deste projeto. O Android já está pronto; o iOS fica pra
quando você tiver acesso a um Mac (o comando seria `npx cap add ios`,
rodado nesse Mac).

## Requisito único: Android Studio

Baixe e instale o [Android Studio](https://developer.android.com/studio)
(gratuito). Ele já vem com tudo que falta (SDK do Android, emulador,
Gradle) — não precisa instalar mais nada separado.

## Passo a passo

1. **Configure as variáveis de ambiente** (as mesmas do site/Vercel — sem
   elas o app abre com tela preta, exatamente como já acontece se
   faltarem no build do desktop). Crie um arquivo `.env` na raiz do
   projeto (do lado do `package.json`) com:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_TURN_URL=...
   VITE_TURN_USERNAME=...
   VITE_TURN_CREDENTIAL=...
   ```
   (os mesmos valores que já estão configurados na Vercel/GitHub Secrets.)

2. **Gere o build e sincronize com o projeto Android** — no terminal, na
   raiz do projeto:
   ```
   npm install
   npm run build:mobile
   ```
   Isso builda a interface web e copia ela pra dentro da pasta
   `android/`. Repita esse comando toda vez que quiser testar uma
   mudança nova no código.

3. **Abra no Android Studio:**
   ```
   npm run cap:open:android
   ```
   (ou abra o Android Studio manualmente e escolha "Open" na pasta
   `android/`).

4. **Rode num emulador ou celular de verdade** — no Android Studio, com o
   projeto aberto, clique no botão verde de "Run" (▶). Na primeira vez,
   o Gradle baixa umas coisas sozinho (pode demorar alguns minutos) — é
   normal.

## O que funciona e o que não funciona ainda

**Deve funcionar** (mesmo código React de sempre, sem mudança nenhuma
nele): login, cadastro, lista de servidores/canais, chat de texto,
**voz e vídeo** (chamadas normais, câmera e microfone do celular).

**Escondido de propósito no app mobile** (não faz sentido ou não existe
num celular): o botão de compartilhar tela/jogo. Ele só aparece no
desktop.

**Ainda precisa de teste de verdade num aparelho Android** (não tenho
como confirmar sem um dispositivo/emulador real, que não existe no
ambiente onde eu trabalho):
- O diálogo do Android pedindo permissão de câmera/microfone na primeira
  abertura (configurei o código pra pedir isso automaticamente — ver
  `android/app/src/main/java/.../MainActivity.java` — mas o primeiro
  teste de verdade só acontece rodando no Android Studio).
- Comportamento em segundo plano (chamada continuar tocando com o app
  minimizado) — hoje não tem nada especial configurado pra isso; se for
  importante, é um ajuste futuro (ver "Próximos passos" abaixo).

## Próximos passos possíveis (não implementados ainda)

- **Notificações push** de chamada/mensagem com o app fechado — precisa
  de um plugin do Capacitor (`@capacitor/push-notifications`) mais
  configuração no Firebase, à parte.
- **Chamada continuar em segundo plano** com o app minimizado — precisa
  de um "foreground service" Android, código nativo adicional.
- **Publicar na Play Store** — precisa de conta de desenvolvedor Google
  (pagamento único), gerar um build assinado (`.aab`), e preencher a
  ficha da loja (ícones, capturas de tela, política de privacidade).
- **iOS** — repetir o processo com um Mac (`npx cap add ios`, abrir no
  Xcode). Precisa de conta de desenvolvedor Apple pra publicar na App
  Store.
