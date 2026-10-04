// Seletor de dispositivo de áudio usado nos menus rápidos (painel e barra
// da chamada). Sempre tem "Padrão do sistema" (segue o Windows), e mostra
// o dispositivo salvo que não está conectado agora como "(desconectado)"
// — antes o seletor mostrava outro aparelho como se fosse o escolhido.
// As entradas "default"/"communications" do Chrome viram só o "Padrão".
type Opt = { deviceId: string; label: string }

export function DeviceSelect({
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: {
  value: string | null
  options: Opt[]
  onChange: (id: string | null) => void
  className: string
  ariaLabel: string
}) {
  const real = options.filter((o) => o.deviceId !== 'default' && o.deviceId !== 'communications' && o.deviceId !== '')
  const current = value && value !== 'default' ? value : ''
  const missing = current && !real.some((o) => o.deviceId === current)
  return (
    <select value={current} onChange={(e) => onChange(e.target.value || null)} className={className} aria-label={ariaLabel}>
      <option value="">Padrão do sistema</option>
      {missing && <option value={current}>Dispositivo salvo (desconectado)</option>}
      {real.map((o) => (
        <option key={o.deviceId} value={o.deviceId}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
