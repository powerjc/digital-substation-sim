import { useState } from 'react'
import SwitchFigure from './SwitchFigure'
import { queueWait, FULL_FRAME_BYTES } from '../../lib/figures'
import { fmtDur } from '../../lib/units'

// VLAN membership (real network model) and a busy port with / without priority
function QueueFigure() {
  const [prio, setPrio] = useState(false)
  const n = 10
  const wait = queueWait({ queued: n, priority: prio })
  const bw = 26, gap = 3, x0 = 12
  // Queue order, front (next out) on the right, next to the port
  const order = prio ? [...Array(n - 1).fill('bulk'), 'trip', 'sending'] : ['trip', ...Array(n - 1).fill('bulk'), 'sending']
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 text-sm text-gray-700">
        <input type="checkbox" checked={prio} onChange={e => setPrio(e.target.checked)} />
        Switch honours priority
      </label>
      <svg viewBox="0 0 400 86" className="w-full h-auto max-w-xl" role="img" aria-label="Frames queued at a busy switch port">
        {order.map((k, i) => {
          const x = x0 + i * (bw + gap)
          const fill = k === 'trip' ? '#dc2626' : k === 'sending' ? '#6b7280' : '#d1d5db'
          return (
            <g key={i}>
              <rect x={x} y={20} width={bw} height={30} rx={3} fill={fill} />
              {k === 'trip' && <text x={x + bw / 2} y={39} textAnchor="middle" fontSize={8.5} fontWeight="700" fill="#fff">TRIP</text>}
            </g>
          )
        })}
        <line x1={x0 + order.length * (bw + gap)} y1={35} x2={388} y2={35} stroke="#6b7280" strokeWidth={2} markerEnd="url(#arr)" />
        <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#6b7280" /></marker></defs>
        <text x={392} y={24} textAnchor="end" fontSize={9} fill="#6b7280">port</text>
        <text x={x0} y={14} fontSize={9} fill="#6b7280">back of the queue</text>
        <text x={x0 + (order.length - 1) * (bw + gap) + bw} y={14} textAnchor="end" fontSize={9} fill="#6b7280">on the wire</text>
        <text x={200} y={74} textAnchor="middle" fontSize={11} fontWeight="700" fill={prio ? '#16a34a' : '#dc2626'}>
          Trip waits {prio ? 'at most ' : ''}{wait < 1e-3 ? `${Math.round(wait * 1e6)} µs` : fmtDur(wait)}
        </text>
      </svg>
      <p className="text-xs text-gray-400">{n} full-size frames ({FULL_FRAME_BYTES} bytes) at 100 Mbit/s, one already being sent. A frame on the wire is never interrupted.</p>
    </div>
  )
}

export default function VlanFigure() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">VLAN membership: the relay multicasts a trip on VLAN 10</div>
        <SwitchFigure mode="vlan" />
      </div>
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Priority: a busy port</div>
        <QueueFigure />
      </div>
    </div>
  )
}
