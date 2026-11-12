// The layers each kind of message uses: MMS goes down the whole stack,
// GOOSE and SV go straight from the application to Ethernet.
const ROWS = [
  { n: '7', name: 'Application' },
  { n: '5–6', name: 'Session,', note2: 'presentation' },
  { n: '4', name: 'Transport' },
  { n: '3', name: 'Network', note: 'routers' },
  { n: '2', name: 'Data link', note: 'switches' },
  { n: '1', name: 'Physical' },
]
const COLS = [
  { id: 'mms', title: 'MMS (SCADA)', color: '#7c3aed', cells: ['MMS', 'ISO session,|presentation', 'TCP', 'IP', 'Ethernet', 'Fibre,|copper'] },
  { id: 'goose', title: 'GOOSE', color: '#2563eb', cells: ['GOOSE', null, null, null, 'Ethernet|0x88B8', 'Fibre,|copper'] },
  { id: 'sv', title: 'SV', color: '#16a34a', cells: ['Sampled|Values', null, null, null, 'Ethernet|0x88BA', 'Fibre,|copper'] },
]
const X0 = 112, CW = 92, GAP = 4, Y0 = 26, RH = 34

export default function LayersFigure() {
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 400 236" className="w-full h-auto max-w-xl" role="img" aria-label="Network layers used by MMS, GOOSE and Sampled Values">
        {COLS.map((c, ci) => (
          <text key={c.id} x={X0 + ci * (CW + GAP) + CW / 2} y={16} textAnchor="middle" fontSize={10.5} fontWeight="700" fill={c.color}>{c.title}</text>
        ))}
        {ROWS.map((r, ri) => {
          const y = Y0 + ri * RH
          return (
            <g key={r.n}>
              <text x={4} y={y + 15} fontSize={10.5} fontWeight="700" fill="#374151">L{r.n}</text>
              <text x={34} y={y + 15} fontSize={10} fill="#374151">{r.name}</text>
              {r.note && <text x={34} y={y + 27} fontSize={8.5} fill="#9ca3af">{r.note}</text>}
              {r.note2 && <text x={34} y={y + 27} fontSize={10} fill="#374151">{r.note2}</text>}
              {COLS.map((c, ci) => {
                const x = X0 + ci * (CW + GAP)
                const v = c.cells[ri]
                return v ? (
                  <g key={c.id}>
                    <rect x={x} y={y + 2} width={CW} height={RH - 6} rx={4} fill={c.color} fillOpacity={0.12} stroke={c.color} strokeWidth={1.25} />
                    {v.split('|').map((line, li, all) => (
                      <text key={li} x={x + CW / 2} y={y + RH / 2 + 3 + (li - (all.length - 1) / 2) * 11} textAnchor="middle" fontSize={9.5} fontWeight="600" fill="#111827">{line}</text>
                    ))}
                  </g>
                ) : (
                  <rect key={c.id} x={x} y={y + 2} width={CW} height={RH - 6} rx={4} fill="none" stroke="#d1d5db" strokeDasharray="3 3" />
                )
              })}
            </g>
          )
        })}
        {/* GOOSE and SV: straight down past the skipped layers */}
        {COLS.slice(1).map((c, i) => {
          const x = X0 + (i + 1) * (CW + GAP) + CW / 2
          return (
            <g key={c.id}>
              <line x1={x} y1={Y0 + RH - 4} x2={x} y2={Y0 + 4 * RH + 2} stroke={c.color} strokeWidth={2.5} markerEnd={`url(#ar-${c.id})`} />
              <defs><marker id={`ar-${c.id}`} markerWidth="8" markerHeight="8" refX="4" refY="6" orient="auto-start-reverse"><path d="M0,0 L8,0 L4,7 z" transform="rotate(-90 4 4)" fill={c.color} /></marker></defs>
              <rect x={x - 22} y={Y0 + 2 * RH + 8} width={44} height={14} rx={3} fill="#fff" />
              <text x={x} y={Y0 + 2 * RH + 19} textAnchor="middle" fontSize={9} fontWeight="700" fill={c.color}>skipped</text>
            </g>
          )
        })}
      </svg>
      <p className="text-xs text-gray-400">Layers 5–6 matter only for MMS; most networking talk is about layers 1–4.</p>
    </div>
  )
}
