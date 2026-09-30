import { Link } from 'react-router-dom'
import { LegalPageLayout, LegalSection } from './LegalPageLayout'

// Responsável e contato: os mesmos da Política de Privacidade. Texto de referência, não é parecer jurídico: vale uma
// revisão por advogado, principalmente das seções 11 (responsabilidade)
// e 14 (foro).

export function TermsOfService() {
  return (
    <LegalPageLayout title="Termos de Uso" updatedAt="30 de setembro de 2026">
      <p className="text-sm text-mv-muted">
        Estes Termos regem o uso do Mamacos Voip (site, versão web e aplicativos para computador e celular). Ao
        criar uma conta ou usar o serviço, você concorda com eles e com a{' '}
        <Link to="/privacidade">Política de Privacidade</Link>. Se não concordar, não use o serviço.
      </p>

      <LegalSection title="1. Quem oferece o serviço">
        <p>
          O Mamacos Voip é um projeto gratuito mantido por uma pessoa física,{' '}
          <strong>Felipe Moreira Soares</strong> (&quot;nós&quot;). Contato:{' '}
          <strong>mamacovoip@gmail.com</strong>.
        </p>
      </LegalSection>

      <LegalSection title="2. O serviço">
        <p>
          O Mamacos Voip é uma plataforma gratuita de chat em texto, voz, vídeo e compartilhamento de tela,
          organizada em servidores, canais, conversas diretas e grupos. Ele é oferecido &quot;no estado em que
          se encontra&quot;, sem garantia de disponibilidade ininterrupta, e pode ser alterado, limitado ou
          encerrado a qualquer momento. Em caso de encerramento do serviço, avisaremos com antecedência
          razoável sempre que possível.
        </p>
      </LegalSection>

      <LegalSection title="3. Idade mínima">
        <p>
          Você precisa ter <strong>18 anos ou mais</strong> para criar uma conta e usar o Mamacos Voip. Ao
          criar a conta, você declara ser maior de idade. Contas de menores de 18 anos serão excluídas quando
          identificadas.
        </p>
      </LegalSection>

      <LegalSection title="4. Sua conta">
        <p>
          Você deve fornecer informações verdadeiras no cadastro, manter sua senha em sigilo e é responsável
          pelo que for feito com a sua conta. Recomendamos ativar a verificação em duas etapas. Se suspeitar de
          uso indevido, troque a senha e nos avise pelo e-mail da seção 1.
        </p>
      </LegalSection>

      <LegalSection title="5. Regras de conduta">
        <p>Ao usar o Mamacos Voip, você concorda em NÃO:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Publicar, transmitir ou pedir qualquer conteúdo sexual envolvendo crianças ou adolescentes, ou tentar
            aliciar menores. Tolerância zero: a conta é excluída e o caso é comunicado às autoridades
            competentes.
          </li>
          <li>
            Publicar pornografia ou conteúdo sexualmente explícito em qualquer lugar do app. Canais marcados como
            +18 aceitam humor e linguagem adulta, mas não pornografia.
          </li>
          <li>
            Divulgar fotos, vídeos ou áudios íntimos de outra pessoa sem o consentimento dela, ou divulgar dados
            pessoais de terceiros (endereço, documentos, telefone etc.) para expor, perseguir ou prejudicar
            alguém.
          </li>
          <li>Assediar, ameaçar, perseguir ou incitar violência contra outras pessoas.</li>
          <li>
            Praticar ou incitar discriminação ou preconceito de raça, cor, etnia, religião, procedência nacional,
            gênero, orientação sexual ou deficiência.
          </li>
          <li>Incentivar automutilação, suicídio ou desafios perigosos.</li>
          <li>Enviar spam, phishing, malware, ou tentar aplicar golpes em outros usuários.</li>
          <li>
            Tentar acessar contas, servidores ou dados que não sejam seus, explorar falhas de segurança ou
            sobrecarregar o serviço com bots, scripts ou automação.
          </li>
          <li>Se passar por outra pessoa, empresa ou pela equipe do Mamacos Voip.</li>
          <li>
            Publicar conteúdo que viole direitos autorais, marcas ou outros direitos de terceiros (por exemplo,
            distribuir jogos, filmes ou softwares piratas).
          </li>
          <li>Publicar qualquer outro conteúdo ou praticar qualquer ato ilegal segundo a lei brasileira.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Conteúdo que você publica">
        <p>
          Você continua sendo o titular do que publica (mensagens, arquivos, imagens, sons etc.) e é o único
          responsável por esse conteúdo. Você declara ter os direitos necessários sobre ele. Ao publicá-lo, você
          nos concede uma autorização gratuita, não exclusiva e limitada para armazenar, reproduzir e transmitir
          esse conteúdo às pessoas com quem você o compartilha, apenas pelo tempo e na medida necessários para
          o funcionamento do serviço. Não usamos seu conteúdo para nenhuma outra finalidade.
        </p>
        <p>
          Não revisamos previamente o conteúdo publicado pelos usuários. Chamadas de voz, vídeo e
          compartilhamentos de tela são retransmitidos em tempo real por servidores de mídia e não são gravados
          nem armazenados por nós.
        </p>
      </LegalSection>

      <LegalSection title="7. Servidores, moderadores e canais +18">
        <p>
          Quem cria um servidor é responsável pelas regras e pela moderação dele. Donos e moderadores podem
          remover mensagens, expulsar, banir ou silenciar membros nos servidores que administram, e recebem as
          denúncias feitas naquele servidor. Um canal só pode ser marcado como +18 para conteúdo adulto
          permitido por estes Termos, e quem entra nele precisa confirmar ter 18 anos ou mais.
        </p>
      </LegalSection>

      <LegalSection title="8. Denúncias e remoção de conteúdo">
        <p>
          Você pode denunciar mensagens e usuários pelo próprio app, e pode também denunciar diretamente para
          nós pelo e-mail da seção 1. Na denúncia por e-mail, informe o link, o servidor, o canal ou a conversa,
          o nome de usuário envolvido e a data aproximada, para que o conteúdo possa ser identificado.
        </p>
        <p>
          Conteúdo que viole direitos de crianças e adolescentes é removido assim que formos comunicados, e
          conteúdo de aparente exploração ou abuso sexual infantil é comunicado às autoridades competentes. Nos
          demais casos, analisamos a denúncia e podemos remover o conteúdo, suspender ou excluir a conta,
          segundo estes Termos e a lei. Também cumprimos ordens judiciais de remoção ou de fornecimento de dados,
          nos termos do Marco Civil da Internet (Lei nº 12.965/2014).
        </p>
      </LegalSection>

      <LegalSection title="9. Direitos autorais">
        <p>
          Se você acredita que algum conteúdo no Mamacos Voip viola um direito autoral seu (Lei nº 9.610/1998),
          envie para o e-mail da seção 1: (a) seu nome e contato; (b) a identificação da obra protegida; (c) a
          localização exata do conteúdo (servidor, canal ou conversa, e mensagem); (d) a informação de que você
          é o titular do direito ou está autorizado a agir em nome dele; e (e) a declaração de que as
          informações são verdadeiras. Podemos remover ou bloquear o conteúdo e avisar quem o publicou, que
          poderá responder à notificação pelo mesmo e-mail. Quem violar direitos de terceiros de forma
          repetida terá a conta encerrada.
        </p>
      </LegalSection>

      <LegalSection title="10. Suspensão e encerramento de conta">
        <p>
          Você pode excluir sua conta a qualquer momento em <em>Configurações → Minha conta → Excluir conta</em>{' '}
          (passo a passo em <Link to="/excluir-conta">Como excluir sua conta</Link>).
          Podemos suspender ou encerrar contas que violem estes Termos ou a lei, ou que coloquem outros usuários
          em risco. Sempre que possível, avisaremos antes e explicaremos o motivo, exceto em casos graves ou
          quando o aviso atrapalhar uma investigação. Se achar que a medida foi um erro, você pode contestá-la
          pelo e-mail da seção 1.
        </p>
      </LegalSection>

      <LegalSection title="11. Limitação de responsabilidade">
        <p>
          O serviço é gratuito e oferecido &quot;no estado em que se encontra&quot;. Não garantimos que ele
          estará sempre disponível, sem erros ou livre de perda de dados. Faça cópia do que for importante para
          você. O conteúdo publicado pelos usuários é de responsabilidade de quem o publicou. Na máxima extensão
          permitida pela lei, não respondemos por danos indiretos, lucros cessantes ou perda de dados decorrentes
          do uso ou da impossibilidade de uso do serviço. Nada nestes Termos limita direitos que a lei
          brasileira garante a você e que não possam ser afastados por contrato.
        </p>
      </LegalSection>

      <LegalSection title="12. Software, marcas e componentes de terceiros">
        <p>
          O aplicativo é oferecido para uso pessoal e não comercial. O nome, o logotipo e a identidade visual do
          Mamacos Voip pertencem ao responsável indicado na seção 1. O app inclui componentes de código aberto
          de terceiros, usados sob suas próprias licenças, listadas no arquivo THIRD_PARTY_NOTICES que acompanha
          o código e o instalador.
        </p>
        <p>
          Nomes de jogos, lojas e outros produtos que aparecem no app (por exemplo, no status &quot;Jogando
          X&quot;) são marcas dos respectivos titulares e aparecem apenas para identificar o jogo em execução.
          O Mamacos Voip não tem afiliação com esses titulares nem é endossado por eles.
        </p>
      </LegalSection>

      <LegalSection title="13. Alterações nestes Termos">
        <p>
          Podemos atualizar estes Termos. A versão em vigor fica sempre nesta página, com a data da última
          atualização. Mudanças relevantes serão avisadas com antecedência razoável dentro do app ou por
          e-mail. Se você não concordar com a nova versão, pode excluir sua conta. Continuar usando o serviço
          depois que a mudança entrar em vigor significa que você concorda com ela.
        </p>
      </LegalSection>

      <LegalSection title="14. Lei aplicável e foro">
        <p>
          Estes Termos são regidos pelas leis da República Federativa do Brasil. Eventuais disputas serão
          resolvidas no foro do domicílio do usuário.
        </p>
      </LegalSection>

      <LegalSection title="15. Contato">
        <p>
          Dúvidas, denúncias ou pedidos sobre estes Termos: <strong>mamacovoip@gmail.com</strong>.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
