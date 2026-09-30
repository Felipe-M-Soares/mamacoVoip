import { Link } from 'react-router-dom'
import { LegalPageLayout, LegalSection } from './LegalPageLayout'

// Controlador e contato (LGPD art. 9º, III): os mesmos de TermsOfService.tsx
// e DeleteAccountInfo.tsx — se mudar, troque nos três.
//
// Este texto descreve o que o código faz em 30/09/2026. Se mudar o que o app
// coleta (novo provedor, analytics, gravação, anúncios etc.), atualize aqui.

export function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Política de Privacidade" updatedAt="30 de setembro de 2026">
      <p className="text-sm text-mv-muted">
        Este documento explica quais dados pessoais o Mamacos Voip trata, para quê, com quem eles são
        compartilhados e quais são os seus direitos, nos termos da Lei Geral de Proteção de Dados Pessoais
        (Lei nº 13.709/2018 — LGPD) e do Marco Civil da Internet (Lei nº 12.965/2014).
      </p>

      <LegalSection title="1. Quem é o responsável pelos seus dados (controlador)">
        <p>
          O Mamacos Voip é um projeto gratuito mantido por uma pessoa física,{' '}
          <strong>Felipe Moreira Soares</strong>, que é o controlador dos dados pessoais tratados no
          app. Para dúvidas sobre privacidade, para exercer seus direitos ou para qualquer comunicação sobre
          dados pessoais, escreva para <strong>mamacovoip@gmail.com</strong>.
        </p>
        <p>
          Como agente de tratamento de pequeno porte, o Mamacos Voip não indicou um encarregado (DPO), conforme
          autoriza a Resolução CD/ANPD nº 2/2022 (art. 11). O e-mail acima é o canal de comunicação com os
          titulares e com a Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </LegalSection>

      <LegalSection title="2. Quais dados tratamos">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Conta:</strong> e-mail, nome de usuário e senha (a senha é guardada pelo provedor de
            autenticação só em forma de hash, nunca em texto puro). Se você entrar com o Google, recebemos do
            Google seu e-mail e seu nome. Se ativar a verificação em duas etapas (2FA), o provedor de
            autenticação guarda o segredo do seu aplicativo autenticador.
          </li>
          <li>
            <strong>Perfil:</strong> nome de exibição, foto de perfil, banner, decoração de avatar, status
            personalizado e a opção de quem pode ver seu perfil completo.
          </li>
          <li>
            <strong>Conteúdo que você cria:</strong> mensagens em canais de servidores, conversas diretas e
            grupos (incluindo edições); arquivos anexados, inclusive mensagens de voz que você grava e envia;
            reações; figurinhas e GIFs enviados; servidores, canais, cargos, emojis, sons do soundboard,
            eventos e tópicos que você cria; mensagens fixadas.
          </li>
          <li>
            <strong>Relacionamentos:</strong> amizades e pedidos de amizade (com a nota opcional do pedido),
            bloqueios, servidores dos quais você participa, apelidos e cargos.
          </li>
          <li>
            <strong>Presença e atividade:</strong> se você está online, ausente, ocupado ou invisível; em qual
            canal de voz está; o aviso de &quot;digitando&quot;; e até onde você já leu cada canal ou conversa
            (para mostrar mensagens não lidas).
          </li>
          <li>
            <strong>Jogo em execução</strong> (só no app para computador): o nome do jogo reconhecido, exibido
            como &quot;Jogando X&quot; — detalhes na seção 4.
          </li>
          <li>
            <strong>Segurança e moderação:</strong> denúncias que você faz ou que são feitas sobre você (motivo,
            detalhes e mensagem denunciada), expulsões, banimentos, castigos e o registro de moderação dos
            servidores, e a data em que você confirmou ter 18 anos ou mais para abrir canais +18.
          </li>
          <li>
            <strong>Dados técnicos:</strong> endereço IP, porta, data e hora de acesso, tipo de dispositivo e
            navegador, registrados automaticamente pelos provedores de infraestrutura (seção 7) para manter o
            serviço funcionando e seguro.
          </li>
        </ul>
        <p>
          Não tratamos dados pessoais sensíveis de propósito e não pedimos CPF, endereço, telefone ou data de
          nascimento. Evite publicar esse tipo de informação no chat.
        </p>
      </LegalSection>

      <LegalSection title="3. Voz, vídeo e compartilhamento de tela">
        <p>
          Chamadas de voz, vídeo e compartilhamentos de tela (inclusive o áudio do jogo ou aplicativo que você
          escolher compartilhar) passam pelos servidores de mídia do <strong>LiveKit Cloud</strong>, que
          recebem o fluxo de cada participante e o retransmitem para os outros participantes da sala, com
          criptografia em trânsito. <strong>O Mamacos Voip não grava nem armazena áudio, vídeo ou tela das
          chamadas.</strong> Para entrar numa sala, o LiveKit recebe o identificador da sua conta e o seu nome
          de exibição.
        </p>
        <p>
          O microfone só é usado quando você entra num canal de voz; câmera e tela, só quando você as ativa.
          A redução de ruído do microfone roda inteiramente no seu dispositivo. Lembre-se de que outros
          participantes podem gravar a chamada com ferramentas próprias, fora do nosso controle.
        </p>
        <p>
          Se você ativar o &quot;apertar para falar&quot; com atalho global no app para computador, o app
          observa o teclado só para saber quando a tecla escolhida é pressionada. Nenhuma tecla é registrada,
          guardada ou enviada.
        </p>
      </LegalSection>

      <LegalSection title="4. Detecção de jogos (app para computador)">
        <p>
          Enquanto o app para computador está aberto e você está conectado, ele consulta a cada poucos
          segundos a lista de processos em execução e qual janela está em primeiro plano, e compara isso, no
          próprio computador, com uma lista de jogos conhecidos e com as pastas de bibliotecas das lojas de
          jogos para PC. Quando reconhece um jogo, só o <strong>nome do jogo</strong> é enviado e salvo no seu
          perfil (&quot;Jogando X&quot;). Jogos fora da lista são identificados pelo nome da pasta em que
          estão instalados. A lista de processos, os caminhos dos arquivos e os títulos das janelas não saem
          do seu computador.
        </p>
        <p>
          O status &quot;Jogando&quot; faz parte do seu perfil, que é visível para outros usuários conectados.
          Com a opção <em>Configurações → Privacidade → Só amigos</em>, o app mostra status e &quot;Jogando&quot;
          apenas para seus amigos. Se não quiser compartilhar o jogo, use a versão web, que não tem detecção de
          jogos.
        </p>
      </LegalSection>

      <LegalSection title="5. Dados guardados no seu próprio dispositivo">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Armazenamento local do navegador/app:</strong> sua sessão de login (no app para computador,
            cifrada pelo sistema operacional), preferências (tema, sons, áudio, atalhos, volumes), rascunhos de
            mensagens, notas pessoais que você escreve sobre outros usuários, itens fixados e figurinhas
            recentes. Esses dados não são enviados para nós.
          </li>
          <li>
            <strong>Cookies:</strong> o Mamacos Voip não usa cookies de publicidade nem ferramentas de
            analytics ou rastreamento.
          </li>
          <li>
            <strong>Log de diagnóstico (app para computador):</strong> o arquivo <code>mamacos-debug.log</code>{' '}
            na pasta de dados do app registra erros técnicos (por exemplo, falhas de captura de tela ou de
            áudio). Ele pode conter nomes de dispositivos de áudio, caminhos de arquivos (que incluem o nome do
            seu usuário no Windows) e o nome do jogo detectado. Fica só no seu computador, tem tamanho
            limitado, nunca é enviado automaticamente e é apagado quando você desinstala o app. Você só nos
            envia esse arquivo se quiser, por exemplo para pedir ajuda.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Para que usamos os dados e com qual base legal">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Prestar o serviço</strong> (conta, perfil, mensagens, servidores, amizades, voz, presença,
            status de jogo, 2FA): execução do contrato que você aceita ao criar a conta (art. 7º, V, da LGPD).
          </li>
          <li>
            <strong>Segurança, prevenção a fraudes e abusos, moderação e tratamento de denúncias</strong>:
            legítimo interesse (art. 7º, IX), sempre limitado ao necessário e respeitando seus direitos.
          </li>
          <li>
            <strong>Atender ordens judiciais, requisições de autoridades e obrigações legais</strong>:
            cumprimento de obrigação legal ou regulatória (art. 7º, II) e exercício regular de direitos em
            processo (art. 7º, VI).
          </li>
          <li>
            <strong>Confirmação de maioridade para canais +18</strong>: execução do contrato e legítimo
            interesse em restringir conteúdo adulto.
          </li>
        </ul>
        <p>
          Não vendemos dados, não exibimos anúncios, não criamos perfis para publicidade e não tomamos decisões
          automatizadas que afetem seus interesses.
        </p>
      </LegalSection>

      <LegalSection title="7. Com quem os dados são compartilhados">
        <p>Usamos os seguintes prestadores de serviço, que tratam dados em nosso nome (operadores):</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>Supabase</strong> — banco de dados, autenticação, armazenamento de arquivos, mensagens em
            tempo real e funções de servidor (inclusive a que gera a prévia de links colados no chat).
          </li>
          <li><strong>LiveKit Cloud</strong> — retransmissão de voz, vídeo e compartilhamento de tela.</li>
          <li><strong>Vercel</strong> — hospedagem do site e da versão web.</li>
        </ul>
        <p>E os seguintes serviços de terceiros, que recebem dados quando você usa o recurso correspondente:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>GIPHY</strong> — quando você abre o seletor de GIFs, o texto pesquisado e o seu endereço IP
            vão para a GIPHY, e os GIFs são carregados direto dos servidores dela.
          </li>
          <li><strong>Google</strong> — só se você escolher entrar com uma conta Google.</li>
          <li>
            <strong>GitHub e lojas de aplicativos</strong> — o download do instalador e a verificação de
            atualizações do app para computador são feitos no GitHub (ou na loja em que você instalou o app),
            que recebe seu endereço IP.
          </li>
          <li>
            <strong>Sites de links e imagens</strong> — ao exibir a prévia de um link ou uma imagem externa
            enviada no chat, seu dispositivo baixa a imagem direto do site de origem, que pode ver seu endereço
            IP.
          </li>
        </ul>
        <p>
          <strong>Outros usuários</strong> veem o que você publica nos servidores, conversas e grupos de que
          participa, além do seu perfil (nome de usuário, nome de exibição, foto e, conforme sua configuração
          de visibilidade no app, status e jogo). Moderadores de um servidor
          veem as denúncias feitas naquele servidor.
        </p>
        <p>
          Também podemos fornecer dados a <strong>autoridades</strong> quando houver ordem judicial ou
          requisição legal válida, na medida exigida pela lei.
        </p>
      </LegalSection>

      <LegalSection title="8. Transferência internacional">
        <p>
          Supabase, LiveKit, Vercel, GIPHY, Google e GitHub são empresas estrangeiras, e seus dados podem ser
          armazenados ou processados fora do Brasil (principalmente nos Estados Unidos), inclusive pelo roteamento
          global de voz e vídeo. Essas transferências são necessárias para prestar o serviço que você pediu e
          são feitas com base nas garantias contratuais de proteção de dados oferecidas por esses provedores,
          nos termos do art. 33 da LGPD.
        </p>
      </LegalSection>

      <LegalSection title="9. Por quanto tempo guardamos os dados">
        <ul className="list-disc list-inside space-y-1">
          <li>Dados da conta, perfil e conteúdo: enquanto a conta existir, ou até você apagar o conteúdo.</li>
          <li>
            Ao <strong>excluir a conta</strong>, são apagados na hora: seu perfil, suas mensagens (em servidores,
            conversas diretas e grupos), reações, amizades, bloqueios, participações, as denúncias feitas por
            você ou sobre você e os servidores dos quais você é dono (inteiros, para todos os membros). Suas
            conversas diretas também são apagadas inteiras, inclusive as mensagens que a outra pessoa enviou
            nelas. Em grupos e servidores de outras pessoas, só as suas mensagens saem.
          </li>
          <li>
            Arquivos (anexos e imagens de perfil) são removidos do armazenamento em uma limpeza separada e podem
            permanecer guardados por algum tempo depois da exclusão. Se quiser a remoção imediata, peça pelo
            e-mail da seção 1.
          </li>
          <li>
            Registros técnicos (endereço IP, data e hora de acesso) e cópias de segurança são mantidos pelos
            provedores de infraestrutura pelos prazos definidos por eles e pela configuração do serviço, e
            eliminados depois disso.
          </li>
          <li>
            Podemos conservar dados por mais tempo quando a lei exigir, quando houver ordem judicial ou para
            defesa em processo (art. 16 da LGPD).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="10. Seus direitos (art. 18 da LGPD)">
        <p>Você pode, gratuitamente, pedir:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>confirmação de que tratamos seus dados e acesso a eles;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD;</li>
          <li>portabilidade dos dados;</li>
          <li>eliminação dos dados tratados com base no seu consentimento;</li>
          <li>informação sobre com quem compartilhamos seus dados;</li>
          <li>informação sobre a possibilidade de não consentir e as consequências disso;</li>
          <li>revogação do consentimento e oposição a tratamento feito em desconformidade com a lei.</li>
        </ul>
        <p>Parte disso você faz sozinho, no próprio app:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Corrigir</strong> o perfil: <em>Editar perfil</em>, no painel do seu usuário.</li>
          <li>
            <strong>Baixar uma cópia</strong> dos seus dados: <em>Configurações → Privacidade</em>. O arquivo
            inclui perfil, configurações privadas, servidores, amizades e até 5.000 mensagens de cada tipo
            (servidores, conversas diretas e grupos). Para uma cópia completa (anexos, denúncias e demais
            registros), peça pelo e-mail.
          </li>
          <li><strong>Excluir a conta</strong>: veja a seção 11.</li>
        </ul>
        <p>
          Para os demais pedidos, escreva para o e-mail da seção 1. Poderemos pedir uma confirmação de que você
          é o titular da conta. Respondemos em até 15 dias. Você também pode apresentar reclamação à ANPD
          (www.gov.br/anpd).
        </p>
      </LegalSection>

      <LegalSection title="11. Como excluir sua conta">
        <div id="excluir-conta" className="space-y-2">
          <p>
            No app (web, computador ou celular): <em>Configurações → Minha conta → Excluir conta</em>, digite
            &quot;excluir&quot; e confirme. Se você usa verificação em duas etapas, o app pede o código antes. A
            exclusão é imediata e não pode ser desfeita.
          </p>
          <p>
            Sem acesso ao app? Entre pela versão web em qualquer navegador, ou peça a exclusão pelo e-mail da
            seção 1 usando o endereço cadastrado na conta. A seção 9 explica o que é apagado e o que pode ser
            mantido.
          </p>
          <p>
            Passo a passo completo: <Link to="/excluir-conta">Como excluir sua conta</Link>.
          </p>
        </div>
      </LegalSection>

      <LegalSection title="12. Segurança e incidentes">
        <p>
          Usamos controle de acesso no banco de dados (cada pessoa só lê e altera o que tem permissão), conexão
          criptografada (HTTPS/TLS) em toda comunicação, anexos em armazenamento privado acessível só por links
          temporários, verificação em duas etapas opcional e sessão cifrada no app para computador. Nenhum
          sistema é totalmente imune a falhas. Se ocorrer um incidente de segurança que possa causar risco ou
          dano relevante a você, comunicaremos a ANPD e os titulares afetados nos prazos e na forma da
          regulamentação da ANPD.
        </p>
      </LegalSection>

      <LegalSection title="13. Idade mínima">
        <p>
          O Mamacos Voip é destinado <strong>somente a maiores de 18 anos</strong>. Não coletamos
          intencionalmente dados de crianças ou adolescentes. Se soubermos que uma conta pertence a menor de
          18 anos, ela será excluída. Responsáveis que identificarem uma conta de menor podem pedir a exclusão
          pelo e-mail da seção 1.
        </p>
      </LegalSection>

      <LegalSection title="14. Mudanças nesta política">
        <p>
          Podemos atualizar este documento. A versão em vigor fica sempre nesta página, com a data da última
          atualização. Mudanças relevantes serão avisadas com antecedência razoável dentro do app ou por
          e-mail.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
