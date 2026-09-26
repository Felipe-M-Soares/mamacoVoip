import { LegalPageLayout, LegalSection } from './LegalPageLayout'

export function TermsOfService() {
  return (
    <LegalPageLayout title="Termos de Uso" updatedAt="16 de agosto de 2026">
      <p className="text-sm text-discord-text-muted">
        Ao criar uma conta no Mamacos Voip, você concorda com estes termos. Leia com atenção.
      </p>

      <LegalSection title="1. O serviço">
        <p>
          O Mamacos Voip é uma plataforma gratuita de chat em texto, voz e vídeo organizada em servidores e
          canais, oferecida "como está", sem garantia de disponibilidade ininterrupta.
        </p>
      </LegalSection>

      <LegalSection title="2. Idade mínima e responsabilidade pela conta">
        <p>
          Você precisa ter pelo menos 13 anos pra criar uma conta. Entre 13 e 18 anos, o uso deve ser
          autorizado por um responsável legal. Você é responsável por manter sua senha em sigilo e por tudo
          que acontecer na sua conta.
        </p>
      </LegalSection>

      <LegalSection title="3. Regras de conduta">
        <p>Ao usar o Mamacos Voip, você concorda em NÃO:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Assediar, ameaçar ou incitar violência contra outras pessoas</li>
          <li>Publicar ou transmitir conteúdo sexual envolvendo menores de idade — tolerância zero, com denúncia imediata às autoridades competentes</li>
          <li>Enviar spam, phishing ou tentar aplicar golpes em outros usuários</li>
          <li>Tentar acessar contas, servidores ou dados que não sejam seus, ou explorar falhas de segurança</li>
          <li>Se passar por outra pessoa ou entidade de forma enganosa</li>
          <li>Publicar conteúdo ilegal sob a legislação brasileira</li>
          <li>Usar bots, scripts ou automação pra sobrecarregar ou manipular o serviço</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Conteúdo que você publica">
        <p>
          Você mantém todos os direitos sobre o conteúdo que cria (mensagens, arquivos, etc.). Ao publicá-lo
          no Mamacos Voip, você nos dá permissão apenas pra armazenar e transmitir esse conteúdo às pessoas
          que você escolher compartilhar (membros do mesmo servidor ou conversa), como necessário pro
          funcionamento do serviço. Não usamos seu conteúdo pra nenhuma outra finalidade.
        </p>
        <p>
          Chamadas de voz e vídeo são transmitidas diretamente entre participantes (peer-to-peer) e não são
          gravadas nem armazenadas por nós.
        </p>
      </LegalSection>

      <LegalSection title="5. Moderação">
        <p>
          Donos de servidor e moderadores podem remover conteúdo, expulsar ou banir membros dentro dos
          servidores que administram. Podemos remover conteúdo ou suspender contas que violem estes termos,
          especialmente em casos de conteúdo ilegal ou que coloque a segurança de outros usuários em risco,
          em linha com o Marco Civil da Internet (Lei nº 12.965/2014).
        </p>
      </LegalSection>

      <LegalSection title="6. Cancelamento">
        <p>
          Você pode excluir sua conta a qualquer momento. Podemos suspender ou encerrar contas que violem
          repetidamente estes termos, com aviso prévio sempre que possível, exceto em casos graves.
        </p>
      </LegalSection>

      <LegalSection title="7. Isenção de garantias e limitação de responsabilidade">
        <p>
          O serviço é oferecido gratuitamente, "como está". Não garantimos disponibilidade ininterrupta,
          ausência de erros, ou que o serviço atenderá a expectativas específicas. Na máxima extensão
          permitida por lei, não nos responsabilizamos por danos indiretos decorrentes do uso do serviço.
        </p>
      </LegalSection>

      <LegalSection title="8. Alterações nestes termos">
        <p>
          Podemos atualizar estes termos de tempos em tempos. Mudanças relevantes serão comunicadas dentro
          do próprio app. O uso continuado após uma mudança significa que você concorda com os novos termos.
        </p>
      </LegalSection>

      <LegalSection title="9. Legislação aplicável">
        <p>Estes termos são regidos pelas leis da República Federativa do Brasil.</p>
      </LegalSection>

      <LegalSection title="10. Contato">
        <p>Dúvidas sobre estes termos: <strong>[SEU E-MAIL DE CONTATO AQUI]</strong>.</p>
      </LegalSection>
    </LegalPageLayout>
  )
}
