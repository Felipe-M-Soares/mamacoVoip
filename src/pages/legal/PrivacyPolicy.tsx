import { LegalPageLayout, LegalSection } from './LegalPageLayout'

export function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Política de Privacidade" updatedAt="16 de agosto de 2026">
      <p className="text-sm text-discord-text-muted">
        Este documento explica quais dados o Mamacos Voip coleta, por quê, e quais direitos você tem sobre
        eles, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>

      <LegalSection title="1. Quem é responsável pelos seus dados">
        <p>
          O Mamacos Voip é operado por <strong>[SEU NOME OU RAZÃO SOCIAL AQUI]</strong>. Dúvidas sobre
          privacidade, ou pra exercer qualquer um dos direitos listados abaixo, entre em contato por{' '}
          <strong>[SEU E-MAIL DE CONTATO AQUI]</strong>.
        </p>
      </LegalSection>

      <LegalSection title="2. Quais dados coletamos">
        <p>Coletamos apenas o que é necessário pro app funcionar:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Cadastro:</strong> e-mail, nome de usuário, senha (armazenada de forma criptografada, nunca em texto puro)</li>
          <li><strong>Perfil:</strong> nome de exibição, foto de perfil (se você enviar uma), status personalizado, ícone do servidor</li>
          <li><strong>Conteúdo que você cria:</strong> mensagens de texto, arquivos anexados, reações, servidores e canais que você cria</li>
          <li><strong>Relacionamentos:</strong> lista de amigos, conversas diretas, bloqueios</li>
          <li><strong>Presença:</strong> se você está online, ausente ou offline, e em qual canal de voz (visível pra outros membros do mesmo servidor)</li>
          <li>
            <strong>Jogo em execução:</strong> se você usa o app desktop e permite, o nome do jogo que você
            está jogando (detectado localmente no seu computador — nenhum outro processo em execução é
            enviado pra nós, só o nome do jogo reconhecido)
          </li>
          <li><strong>Dados técnicos automáticos:</strong> endereço IP e informações básicas de conexão, coletados pela nossa infraestrutura (Vercel e Supabase) pra manter o serviço funcionando e seguro</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. O que NÃO coletamos nem armazenamos">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Áudio e vídeo de chamadas de voz não são gravados nem armazenados.</strong> As chamadas
            usam WebRTC, uma tecnologia que conecta os participantes diretamente entre si (peer-to-peer) —
            nossos servidores só ajudam a estabelecer essa conexão inicial (sinalização), mas o áudio/vídeo
            em si não passa nem fica guardado neles.
          </li>
          <li>Não vendemos nem compartilhamos seus dados com terceiros pra fins de publicidade.</li>
          <li>Não usamos cookies de rastreamento publicitário. As poucas preferências salvas no seu navegador (tema escolhido, sons ligados/desligados) ficam só no seu dispositivo.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Por que coletamos esses dados (base legal)">
        <p>
          Tratamos seus dados com base na <strong>execução do contrato</strong> que você aceita ao criar
          uma conta (Art. 7º, V da LGPD) — ou seja, é o mínimo necessário pra fornecer o serviço que você
          pediu — e no seu <strong>consentimento</strong> (Art. 7º, I), que você pode revogar a qualquer
          momento excluindo sua conta.
        </p>
      </LegalSection>

      <LegalSection title="5. Com quem seus dados são compartilhados">
        <p>Usamos os seguintes prestadores de serviço (operadores de dados, na definição da LGPD) pra fazer o app funcionar:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Supabase</strong> — banco de dados, autenticação e armazenamento de arquivos</li>
          <li><strong>Vercel</strong> — hospedagem do site</li>
        </ul>
        <p>
          Esses provedores podem processar dados em servidores fora do Brasil. Ambos têm políticas de
          segurança e privacidade próprias, disponíveis em seus respectivos sites.
        </p>
      </LegalSection>

      <LegalSection title="6. Seus direitos">
        <p>Você pode, a qualquer momento e gratuitamente:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Acessar todos os dados que temos sobre você</li>
          <li>Corrigir dados incorretos ou desatualizados (editável direto no seu perfil)</li>
          <li>Excluir sua conta e todos os dados associados a ela</li>
          <li>Solicitar uma cópia dos seus dados em formato portável</li>
          <li>Revogar seu consentimento</li>
        </ul>
        <p>Pra exercer qualquer um desses direitos, entre em contato pelo e-mail informado na seção 1.</p>
      </LegalSection>

      <LegalSection title="7. Por quanto tempo guardamos seus dados">
        <p>
          Seus dados ficam armazenados enquanto sua conta existir. Ao excluir sua conta, seus dados pessoais
          são removidos — mensagens em servidores compartilhados podem permanecer visíveis pra outros
          membros (como acontece em qualquer chat em grupo), mas seu perfil deixa de existir e o vínculo com
          você é removido.
        </p>
      </LegalSection>

      <LegalSection title="8. Segurança">
        <p>
          Usamos controles de acesso em nível de banco de dados (Row Level Security) que garantem que cada
          pessoa só consiga ver e alterar exatamente o que tem permissão, conexão criptografada (HTTPS/TLS)
          em toda comunicação, e senhas nunca são armazenadas em texto puro.
        </p>
      </LegalSection>

      <LegalSection title="9. Idade mínima">
        <p>
          O Mamacos Voip não é direcionado a menores de 13 anos. Se você tem entre 13 e 18 anos, o uso deve
          ser autorizado por um responsável legal, conforme o Art. 14 da LGPD.
        </p>
      </LegalSection>

      <LegalSection title="10. Mudanças nesta política">
        <p>
          Podemos atualizar este documento de tempos em tempos. Mudanças relevantes serão comunicadas dentro
          do próprio app.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
