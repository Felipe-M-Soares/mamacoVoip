export function MessageListSkeleton() {
  // Larguras variadas pra não parecer um bloco uniforme e artificial —
  // mais parecido com texto de verdade "carregando".
  const rows = [
    { avatar: true, lines: [72, 45] },
    { avatar: false, lines: [58] },
    { avatar: false, lines: [85, 30] },
    { avatar: true, lines: [40] },
    { avatar: false, lines: [66, 52] },
    { avatar: true, lines: [78] },
  ]

  return (
    <div className="flex-1 overflow-hidden px-4 py-4 space-y-4">
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-3 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
          {row.avatar ? (
            <div className="w-10 h-10 rounded-full bg-white/5 shrink-0" />
          ) : (
            <div className="w-10 shrink-0" />
          )}
          <div className="flex-1 space-y-2 pt-1">
            {row.avatar && <div className="h-3 rounded bg-white/5" style={{ width: '30%' }} />}
            {row.lines.map((w, j) => (
              <div key={j} className="h-3 rounded bg-white/5" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
