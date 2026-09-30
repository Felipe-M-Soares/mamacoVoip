import { Link } from 'react-router-dom'
import { LegalPageLayout, LegalSection } from './LegalPageLayout'

// Página pública (sem login) explicando como excluir a conta — a Google
// Play exige um link assim na ficha do app ("Exclusão de dados").
//
// E-mail de contato: o mesmo de PrivacyPolicy.tsx e TermsOfService.tsx.

export function DeleteAccountInfo() {
  return (
    <LegalPageLayout title="Como excluir sua conta" updatedAt="30 de setembro de 2026">
      <p className="text-sm text-mv-muted">
        Você pode excluir sua conta do Mamacos Voip a qualquer momento, sem custo. Esta página explica como
        fazer isso pelo app ou por e-mail, e o que acontece com os seus dados.
      </p>

      <LegalSection title="1. Pelo app (web, computador ou celular)">
        <ol className="list-decimal list-inside space-y-1.5">
          <li>Entre na sua conta.</li>
          <li>
            Abra as <strong>Configurações</strong> (ícone de engrenagem no painel do seu usuário, no canto
            inferior esquerdo).
          </li>
          <li>
            Vá em <strong>Minha conta</strong> e role até <strong>Excluir conta</strong>.
          </li>
          <li>
            Clique em <strong>Excluir conta</strong>, digite <strong>excluir</strong> no campo de confirmação e
            clique em <strong>Excluir de vez</strong>.
          </li>
        </ol>
        <p>
          A exclusão é imediata e não pode ser desfeita. Se você é dono de algum servidor, ele é apagado inteiro
          para todos os membros — transfira a propriedade antes, se quiser mantê-lo.
        </p>
        <p>
          Sem o app instalado? Use a versão web em qualquer navegador — o caminho é o mesmo.
        </p>
      </LegalSection>

      <LegalSection title="2. Por e-mail">
        <p>
          Se não conseguir entrar na conta, envie um pedido de exclusão para <strong>mamacovoip@gmail.com</strong>{' '}
          a partir do endereço de e-mail cadastrado na conta, informando seu nome de usuário. Podemos pedir uma
          confirmação de que você é o titular. Respondemos em até 15 dias.
        </p>
      </LegalSection>

      <LegalSection title="3. O que é apagado">
        <ul className="list-disc list-inside space-y-1">
          <li>
            Na hora: perfil, imagens de perfil (avatar, banner e decoração), mensagens (em servidores, conversas
            diretas e grupos), reações, amizades, bloqueios, participações, denúncias feitas por você ou sobre
            você e os servidores dos quais você é dono.
          </li>
          <li>
            Anexos enviados em mensagens são removidos do armazenamento em uma limpeza separada e podem ficar
            guardados por algum tempo depois da exclusão.
          </li>
          <li>
            Registros técnicos e cópias de segurança dos provedores de infraestrutura são eliminados nos prazos
            deles, e podemos conservar dados quando a lei exigir.
          </li>
        </ul>
        <p>
          Os detalhes estão na <Link to="/privacidade">Política de Privacidade</Link> (seções 9 e 11). Veja também
          os <Link to="/termos">Termos de Uso</Link>.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
