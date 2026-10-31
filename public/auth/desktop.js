// Ponte do login com Google do app de PC.
//
// O Google/Supabase devolve a pessoa pra ESTA página (um endereço https
// normal, que já está liberado no Supabase) com ?code=...&state=...; ela
// repassa os dois pro app pelo link mamacovoip://auth-callback. Antes o
// Supabase tentava voltar direto pro mamacovoip:// e, quando esse endereço
// não estava na lista de "Redirect URLs", jogava a pessoa pro site e o
// login nunca chegava no app.
//
// O "code" sozinho não serve pra nada: só vira sessão junto com a chave
// secreta (PKCE) que ficou guardada dentro do app que pediu o login.
;(function () {
  var q = new URLSearchParams(window.location.search)
  var code = q.get('code') || ''
  var state = q.get('state') || ''
  var err = q.get('error_description') || q.get('error')
  var title = document.getElementById('title')
  var msg = document.getElementById('msg')
  var btn = document.getElementById('open')
  var hint = document.getElementById('hint')

  function fail(text) {
    document.body.classList.add('erro')
    title.textContent = 'Não deu pra entrar'
    msg.textContent = text
    btn.hidden = true
    hint.textContent = 'Volte pro app e tente "Entrar com Google" de novo.'
  }

  if (err) return fail(String(err).slice(0, 200))
  var ok = /^[A-Za-z0-9._~-]{1,512}$/
  if (!ok.test(code) || !ok.test(state)) return fail('O link de login está incompleto ou expirou.')

  var link = 'mamacovoip://auth-callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state)
  btn.href = link
  // Tira o code da barra de endereço/histórico.
  try {
    window.history.replaceState(null, '', window.location.pathname)
  } catch (e) {}
  // Tenta abrir sozinho; se o navegador bloquear, o botão resolve.
  setTimeout(function () {
    window.location.href = link
  }, 150)
})()
