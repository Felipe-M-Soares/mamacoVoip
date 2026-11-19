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
  if (!ok.test(code) || (state && !ok.test(state))) return fail('O link de login está incompleto ou expirou.')

  var link = 'mamacovoip://auth-callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state)
  var flow = q.get('sb_flow_id') || ''
  if (/^[A-Za-z0-9_-]{1,128}$/.test(flow)) link += '&sb_flow_id=' + encodeURIComponent(flow)
  btn.href = link
  try {
    window.history.replaceState(null, '', window.location.pathname)
  } catch {}
  setTimeout(function () {
    window.location.href = link
  }, 150)
})()
