import { useMemo, useState } from 'react'
import { DEMO_DEVICES, SEND_KINDS, demoSend } from '../../lib/figures'
import { useClock, lerp, Seg } from './anim.jsx'

// Four devices on one switch, running the real network model.
// mode 'kinds': pick unicast / broadcast / multicast, toggle multicast filtering.
// mode 'vlan': multicast only, toggle which ports carry VLAN 10.
const POS = {
  D1: { x: 6, y: 106 }, D2: { x: 150, y: 6 }, D3: { x: 294, y: 106 }, D4: { x: 150, y: 206 },
}
const W = 100, H = 48
const SW = { x: 165, y: 112, w: 70, h: 36 }
const mid = id => ({ x: POS[id].x + W / 2, y: POS[id].y + H / 2 })
const swEdge = id => {
  const c = { x: SW.x + SW.w / 2, y: SW.y + SW.h / 2 }
  if (id === 'D1') return { x: SW.x, y: c.y }
  if (id === 'D3') return { x: SW.x + SW.w, y: c.y }
  if (id === 'D2') return { x: c.x, y: SW.y }
  return { x: c.x, y: SW.y + SW.h }
}
const devEdge = id => {
  const p = POS[id]
  if (id === 'D1') return { x: p.x + W, y: p.y + H / 2 }
  if (id === 'D3') return { x: p.x, y: p.y + H / 2 }
  if (id === 'D2') return { x: p.x + W / 2, y: p.y + H }
  return { x: p.x + W / 2, y: p.y }
}
const PORT = { D1: 1, D2: 2, D3: 3, D4: 4 }

export default function SwitchFigure({ mode = 'kinds' }) {
  const [kind, setKind] = useState('multicast')
  const [filter, setFilter] = useState(false)
  const [vlan10, setVlan10] = useState({ 2: true, 3: true, 4: true })
  const k = mode === 'vlan' ? 'multicast' : kind
  const opts = mode === 'vlan' ? { vlan10 } : { filter }
  const res = useMemo(() => demoSend(k, opts), [k, JSON.stringify(opts)]) // eslint-disable-line react-hooks/exhaustive-deps
  const runKey = `${k}-${JSON.stringify(opts)}`
  const t = useClock(runKey, true, 2.2)
  const p1 = Math.min(1, t / 0.8), p2 = Math.min(1, Math.max(0, (t - 0.8) / 0.8))
  const done = t >= 1.7

  const dots = []
  if (p1 < 1) dots.push(lerp(devEdge('D1'), swEdge('D1'), p1))
  else if (p2 < 1) for (const d of ['D2', 'D3', 'D4']) if (res.devices[d].arrived) dots.push(lerp(swEdge(d), devEdge(d), p2))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'kinds' ? (
          <>
            <Seg options={Object.entries(SEND_KINDS).map(([id, v]) => ({ id, label: v.label }))} value={kind} onChange={setKind} />
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <input type="checkbox" checked={filter} onChange={e => setFilter(e.target.checked)} disabled={kind !== 'multicast'} />
              Multicast filtering
            </label>
          </>
        ) : (
          <div className="flex flex-wrap gap-3 text-sm text-gray-700">
            {[2, 3, 4].map(n => (
              <label key={n} className="flex items-center gap-1.5">
                <input type="checkbox" checked={vlan10[n]} onChange={e => setVlan10(v => ({ ...v, [n]: e.target.checked }))} />
                Port {n} carries VLAN 10
              </label>
            ))}
          </div>
        )}
      </div>
      <svg viewBox="0 0 400 262" className="w-full h-auto max-w-xl select-none" role="img" aria-label="Switch forwarding figure">
        {DEMO_DEVICES.map(d => {
          const a = devEdge(d.id), b = swEdge(d.id)
          const r = res.devices[d.id]
          const used = d.id === 'D1' || (r?.arrived && done)
          const vlanOff = mode === 'vlan' && d.id !== 'D1' && !vlan10[PORT[d.id]]
          return (
            <g key={d.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={used ? '#2563eb' : '#d1d5db'} strokeWidth={used ? 3 : 2.5} />
              <text x={(a.x + b.x) / 2 + (d.id === 'D2' || d.id === 'D4' ? 6 : 0)} y={(a.y + b.y) / 2 + (d.id === 'D1' || d.id === 'D3' ? -6 : 3)}
                textAnchor={d.id === 'D1' || d.id === 'D3' ? 'middle' : 'start'} fontSize={9} fill={vlanOff ? '#dc2626' : '#9ca3af'}>P{PORT[d.id]}{mode === 'vlan' ? (vlanOff ? ' V20' : ' V10') : ''}</text>
            </g>
          )
        })}
        <rect x={SW.x} y={SW.y} width={SW.w} height={SW.h} rx={5} fill="#f8fafc" stroke="#475569" strokeWidth={1.5} />
        <text x={SW.x + SW.w / 2} y={SW.y + 22} textAnchor="middle" fontSize={11} fontWeight="700" fill="#475569">Switch</text>
        {DEMO_DEVICES.map(d => {
          const p = POS[d.id]
          const r = res.devices[d.id]
          const status = d.id === 'D1' ? { text: 'sender', color: '#2563eb' }
            : !done ? { text: d.role, color: '#9ca3af' }
            : !r.arrived ? { text: r.why.includes('VLAN') ? '— blocked by VLAN' : '— not sent here', color: '#9ca3af' }
            : r.kept ? { text: '✓ keeps it', color: '#16a34a' }
            : { text: '✗ discards it', color: '#b45309' }
          return (
            <g key={d.id}>
              <rect x={p.x} y={p.y} width={W} height={H} rx={6} fill="#fff" stroke={d.id === 'D1' ? '#2563eb' : '#6b7280'} strokeWidth={1.5} />
              <text x={p.x + W / 2} y={p.y + 17} textAnchor="middle" fontSize={12} fontWeight="700" fill="#374151">{d.label}</text>
              <text x={p.x + W / 2} y={p.y + 31} textAnchor="middle" fontSize={8} fill="#9ca3af">{d.mac}</text>
              <text x={p.x + W / 2} y={p.y + 43} textAnchor="middle" fontSize={10.5} fontWeight="700" fill={status.color}>{status.text}</text>
            </g>
          )
        })}
        {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={5.5} fill="#2563eb" stroke="#fff" strokeWidth={1.5} />)}
      </svg>
      {done && (
        <ul className="text-xs text-gray-600 space-y-0.5">
          {DEMO_DEVICES.slice(1).map(d => {
            const r = res.devices[d.id]
            return <li key={d.id}><span className="font-semibold">{d.label}:</span> {r.arrived ? (r.kept ? `keeps it (${r.why})` : `receives it, ${r.why}`) : `never receives it (${r.why})`}</li>
          })}
        </ul>
      )}
    </div>
  )
}
