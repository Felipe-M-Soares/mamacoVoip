export function ChannelSidebarSkeleton() {
  const widths = [55, 70, 45, 65, 50]

  return (
    <div className="px-2 pt-3 space-y-1">
      {widths.map((w, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2 py-1.5 animate-pulse"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="w-4 h-4 rounded bg-white/5 shrink-0" />
          <div className="h-3 rounded bg-white/5" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}
