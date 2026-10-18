# App Android (APK)

O APK é gerado sozinho pelo GitHub junto com cada versão do app de PC e
fica no mesmo release, com o nome fixo `MamacosVoip.apk`. O site mostra o
botão **"Android"** (e, no navegador do celular Android, o banner "Baixe o
app pra Android") apontando pra ele.

Custo: zero (GitHub Actions é grátis pra repositório público; o APK não
passa pela Play Store).

## Configurar (uma vez só)

### 1. Senha da chave

GitHub → **Settings → Secrets and variables → Actions → New repository secret**

| Nome | Valor |
|---|---|
| `ANDROID_KEYSTORE_PASSWORD` | Uma senha forte criada por você (12+ caracteres). **Anote num lugar seguro.** |

### 2. Gerar a chave de assinatura

1. **Actions → "Criar chave do Android (uma vez só)" → Run workflow**.
2. Quando terminar, abra a execução → **Artifacts** → baixe `chave-android`.
3. Abra o arquivo `ANDROID_KEYSTORE_BASE64.txt` (é um texto enorme numa
   linha só) e copie tudo.
4. Crie o secret `ANDROID_KEYSTORE_BASE64` com esse texto.
5. **Guarde uma cópia desse .txt num lugar seguro** (pendrive, Google
   Drive pessoal) e apague do Downloads. Se a chave se perder, quem já
   instalou o app vai ter que desinstalar pra instalar a próxima versão.

Não rode esse workflow de novo depois — ele criaria uma chave diferente.

### 3. Liberar o login com Google no app

Supabase → **Authentication → URL Configuration → Redirect URLs → Add URL**:

```
com.mamacosvoip.app://auth-callback
```

(É assim que o Google devolve o login pro app do celular.)

### 4. Gerar

O próximo push na `main` (ou **Actions → Build e publicar app desktop →
Run workflow**) já gera o APK e coloca no release.

## Instalar no celular

1. No celular, abra o site e toque em **Android** (ou no banner).
2. O Android avisa que é um app de fora da Play Store: toque em
   **Configurações → Permitir desta fonte** e volte.
3. **Instalar**.

Atualizar: baixar e instalar o APK novo por cima (os dados continuam).

## O que funciona no celular

Chat, servidores, DMs, chamadas de voz e vídeo, assistir transmissões
(com escolha de qualidade), login por e-mail e Google. Compartilhar a tela
do celular, overlay de jogo e atalhos globais são só do app de PC.
