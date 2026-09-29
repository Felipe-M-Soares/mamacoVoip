export function ChannelSidebarSkeleton() {
  const widths = [55, 70, 45, 65, 50]

  return (
    <div className="pt-1 space-y-0.5" role="status" aria-label="Carregando canais">
      <div className="h-2.5 w-24 rounded-full bg-white/[0.06] mx-2.5 mb-3 animate-pulse" />
      {widths.map((w, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 px-2.5 py-[9px] animate-pulse"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="w-5 h-5 rounded-md bg-white/[0.06] shrink-0" />
          <div className="h-2.5 rounded-full bg-white/[0.05]" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}
