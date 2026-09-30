// Copia texto pra área de transferência de um jeito que funciona no app
// de computador (pela área de transferência do sistema, via Electron) e no
// navegador (Clipboard API, com o método antigo como reserva — alguns
// navegadores recusam a API sem foco/permissão). Devolve true se copiou.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.electronAPI?.copyText && (await window.electronAPI.copyText(text))) return true
  } catch {
    // segue pras outras formas
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // segue pra reserva
  }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  } catch {
    return false
  }
}
