# Como tirar o aviso "O Windows protegeu o computador"

O aviso (SmartScreen) aparece porque o instalador não tem **assinatura digital**. Não há como
remover isso só mudando código: o Windows exige uma assinatura de alguém que a Microsoft reconheça.
Opções, da mais recomendada (e grátis) para a menos:

## 1. Microsoft Store — grátis, remove o aviso de vez (recomendado)

Desde set/2025 a conta de desenvolvedor individual na Store é **gratuita**. Apps enviados como
pacote MSIX são **assinados pela própria Microsoft** depois da aprovação, então o usuário instala
pela Store sem aviso nenhum, e as atualizações também vêm pela Store.

1. Crie a conta em https://storedeveloper.microsoft.com (conta individual; pede documento com foto
   e uma selfie para verificação).
2. No Partner Center, reserve o nome **Mamacos Voip**.
3. Em *Product identity* copie dois valores:
   - `Package/Identity/Name` (ex.: `12345FelipeMSoares.MamacosVoip`)
   - `Package/Identity/Publisher` (ex.: `CN=ABCD1234-...`)
4. No GitHub do projeto: *Settings → Secrets and variables → Actions → aba Variables* e crie
   `MS_STORE_IDENTITY_NAME` e `MS_STORE_PUBLISHER` com esses valores.
5. No próximo push, o workflow gera também o artefato **mamacos-voip-microsoft-store** (arquivo
   `.appx`). Baixe na página da execução do workflow e envie no Partner Center (*Packages*).
6. Preencha a ficha (descrição, capturas de tela, classificação etária, política de privacidade:
   `https://mamaco-voip.vercel.app/privacidade`) e envie para certificação.
7. Depois de aprovado, troque o link "Baixar o app pra PC" (`src/lib/config.ts`) pelo link da Store.

Observações:
- O app já detecta quando está rodando pela Store e desliga o atualizador próprio (quem atualiza é a Store).
- O instalador `.exe` do GitHub continua existindo para quem preferir — mas esse continua com aviso.
- A Store pede classificação etária: como há canais +18 com confirmação de idade, responda o
  questionário com sinceridade (conteúdo gerado por usuários + interação online).

## 2. SignPath Foundation — grátis, só se o projeto for código aberto

Se o repositório for público com licença open source (MIT, GPL etc.), dá para pedir assinatura
gratuita em https://signpath.org. Eles assinam os `.exe` pelo GitHub Actions. O aviso some aos
poucos, conforme o certificado ganha reputação. Exige repositório público e processo de aprovação.

## 3. Pago (se um dia quiser)

- Certificado OV de código: ~US$ 150–300/ano, funciona no Brasil. O aviso some com o tempo
  (reputação), não na hora.
- Azure Artifact Signing (~US$ 10/mês): hoje só para pessoas físicas dos EUA/Canadá.

## Enquanto isso (grátis, ajuda um pouco)

- Envie cada nova versão do `.exe` para análise em https://www.microsoft.com/wdsi/filesubmission
  ("Software developer" → "Incorrectly detected"). Ajuda quando o Defender marca como suspeito.
- Oriente quem baixar: no aviso azul, clicar em **"Mais informações" → "Executar assim mesmo"**.
- Mantenha sempre o mesmo nome de arquivo e publique pelo mesmo lugar (GitHub Releases): o
  SmartScreen acumula reputação por arquivo baixado.
