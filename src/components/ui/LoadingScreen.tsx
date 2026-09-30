export function LoadingScreen() {
  return (
    <div className="min-h-full bg-mv-canvas flex items-center justify-center relative overflow-hidden" role="status" aria-label="Carregando">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 700px 480px at 50% 42%, color-mix(in srgb, var(--color-mv-accent) 14%, transparent), transparent 70%)',
        }}
      />
      <div className="relative flex flex-col items-center gap-6 animate-fade-in">
        <div className="relative">
          <img src="/logo.png" alt="Mamacos Voip" className="w-20 h-20 rounded-[26px] object-cover ring-1 ring-[var(--color-line-strong)] shadow-[0_20px_50px_-15px_var(--color-mv-accent)]" />
        </div>
        <div className="flex flex-col items-center gap-3">
          <span className="font-display text-white font-semibold tracking-tight">Mamacos Voip</span>
          <div className="w-36 h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-brand-gradient animate-[loading-bar_1.1s_ease-in-out_infinite]" />
          </div>
        </div>
      </div>
      <style>{`@keyframes loading-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  )
}
