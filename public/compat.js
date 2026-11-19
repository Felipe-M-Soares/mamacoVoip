(function () {
  try {
    var cap = window.Capacitor
    var native = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())
    if (native) {
      document.documentElement.classList.add('mv-native')
      var vp = document.querySelector('meta[name=viewport]')
      if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1.0')
    }
  } catch {
    void 0
  }
  var MIN_CHROME = 111
  var ua = navigator.userAgent || ''
  var isAndroid = /Android/i.test(ua)
  var m = ua.match(/Chrome\/(\d+)/)
  var chrome = m ? parseInt(m[1], 10) : 0
  var webviewLink = 'https://play.google.com/store/apps/details?id=com.google.android.webview'
  var chromeLink = 'https://play.google.com/store/apps/details?id=com.android.chrome'

  function show(title, text, extra) {
    var root = document.getElementById('root')
    if (!root) return
    root.innerHTML =
      '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:28px;text-align:center;background:#07070a;color:#f3efee;font-family:system-ui,sans-serif">' +
      '<h1 style="font-size:20px;margin:0">' + title + '</h1>' +
      '<p style="margin:0;max-width:420px;color:#a39a9c;font-size:14px;line-height:1.5">' + text + '</p>' +
      (extra || '') +
      '<p style="margin:0;color:#6b6466;font-size:11px">Android WebView ' + (chrome || '?') + '</p>' +
      '</div>'
  }

  function button(href, label) {
    return '<a href="' + href + '" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#E11D48;color:#fff;text-decoration:none;font-weight:600;font-size:14px">' + label + '</a>'
  }

  if (isAndroid && chrome && chrome < MIN_CHROME) {
    window.__mvOldWebView = true
    var help =
      '<div style="display:flex;flex-direction:column;gap:10px;align-items:center">' +
      button(webviewLink, 'Atualizar Android System WebView') +
      button(chromeLink, 'Atualizar Google Chrome') +
      '</div>'
    var render = function () {
      show(
        'Atualize o navegador do celular',
        'O Mamacos Voip precisa de uma versão mais nova do componente "Android System WebView" (ou do Google Chrome). Atualize pela Play Store e abra o app de novo.',
        help
      )
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render)
    else render()
    return
  }

  if (!isAndroid) return
  setTimeout(function () {
    var root = document.getElementById('root')
    if (!root || root.children.length > 0) return
    show(
      'O app não conseguiu abrir',
      'Feche e abra o Mamacos Voip de novo. Se continuar assim, atualize o "Android System WebView" e o Google Chrome pela Play Store, ou mande um print desta tela para o suporte.',
      button(webviewLink, 'Atualizar Android System WebView')
    )
  }, 12000)
})()
