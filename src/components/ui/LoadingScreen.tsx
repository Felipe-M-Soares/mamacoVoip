export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-discord-darker flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 900px 600px at 50% 40%, color-mix(in srgb, var(--color-discord-blurple) 18%, transparent), transparent 70%)',
        }}
      />
      <div className="relative flex flex-col items-center gap-5">
        <div className="relative">
          <img src="/logo.png" alt="Mamacos Voip" className="w-20 h-20 rounded-full object-cover brand-glow" />
          <div className="absolute inset-0 rounded-full border-2 border-discord-blurple/40 animate-ping" />
        </div>
        <div className="w-7 h-7 border-2 border-discord-blurple border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  )
}
