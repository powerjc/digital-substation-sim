import { useState } from 'react'
import { Seg } from './anim.jsx'

// Where each kind of message goes in a station: MMS crosses the router,
// GOOSE and SV stay inside their own network.
const BOX = {
  cc: { x: 130, y: 4, w: 140, h: 30, t: 'Control centre (SCADA)' },
  rt: { x: 150, y: 52, w: 100, h: 26, t: 'Router / firewall' },
  hmi: { x: 10, y: 120, w: 80, h: 30, t: 'HMI' },
  gw: { x: 100, y: 120, w: 80, h: 30, t: 'Gateway' },
  r1: { x: 190, y: 120, w: 90, h: 30, t: 'Relay 21-AB' },
  r2: { x: 290, y: 120, w: 100, h: 30, t: 'Relay 21-AX' },
  mu: { x: 120, y: 218, w: 110, h: 30, t: 'Merging unit' },
  bk: { x: 250, y: 218, w: 110, h: 30, t: 'Breaker IED' },
}
const SB_Y = 104, PB_Y = 196
const cx = b => b.x + b.w / 2

const FLOWS = {
  mms: { label: 'MMS (SCADA)', color: '#7c3aed', boxes: ['cc', 'rt', 'gw', 'hmi', 'r1', 'r2'], station: true, process: false, crossesRouter: true,
    text: 'SCADA and the HMI read values, receive reports and send controls over TCP/IP. It crosses the router to the control centre.' },
  goose: { label: 'GOOSE', color: '#2563eb', boxes: ['r1', 'r2', 'bk'], station: true, process: true, crossesRouter: false,
    text: 'Between relays on the station bus (blocking, breaker failure) and from relay to breaker IED on the process bus. The router stops it: there is no IP packet to route.' },
  sv: { label: 'Sampled Values', color: '#16a34a', boxes: ['mu', 'r1'], station: false, process: true, crossesRouter: false,
    text: 'From the merging unit to the protection relays on the process bus, thousands of messages a second. Never leaves its network.' },
}

export default function StationFigure() {
  const [flow, setFlow] = useState('goose')
  const f = FLOWS[flow]
  const on = id => f.boxes.includes(id)
  const drop = (id, y) => <line key={id + y} x1={cx(BOX[id])} y1={y} x2={cx(BOX[id])} y2={y === SB_Y ? BOX[id].y : BOX[id].y} stroke={on(id) ? f.color : '#d1d5db'} strokeWidth={on(id) ? 3 : 2} />
  return (
    <div className="flex flex-col gap-2">
      <Seg options={Object.entries(FLOWS).map(([id, v]) => ({ id, label: v.label }))} value={flow} onChange={setFlow} />
      <svg viewBox="0 0 400 256" className="w-full h-auto max-w-xl" role="img" aria-label="Station networks and message flows">
        {/* WAN and router */}
        <line x1={200} y1={34} x2={200} y2={52} stroke={f.crossesRouter ? f.color : '#d1d5db'} strokeWidth={f.crossesRouter ? 3 : 2} />
        <line x1={200} y1={78} x2={200} y2={SB_Y} stroke={f.crossesRouter ? f.color : '#d1d5db'} strokeWidth={f.crossesRouter ? 3 : 2} />
        {/* Station bus */}
        <line x1={10} y1={SB_Y} x2={390} y2={SB_Y} stroke={f.station ? f.color : '#9ca3af'} strokeWidth={f.station ? 3 : 2} />
        <text x={12} y={SB_Y - 4} fontSize={9} fontWeight="700" fill="#6b7280">STATION BUS</text>
        {['hmi', 'gw', 'r1', 'r2'].map(id => drop(id, SB_Y))}
        {/* Process bus */}
        <line x1={10} y1={PB_Y} x2={390} y2={PB_Y} stroke={f.process ? f.color : '#9ca3af'} strokeWidth={f.process ? 3 : 2} />
        <text x={12} y={PB_Y - 4} fontSize={9} fontWeight="700" fill="#6b7280">PROCESS BUS</text>
        {['r1', 'r2'].map(id => (
          <line key={id + 'pb'} x1={cx(BOX[id])} y1={BOX[id].y + BOX[id].h} x2={cx(BOX[id])} y2={PB_Y}
            stroke={on(id) && f.process ? f.color : '#d1d5db'} strokeWidth={on(id) && f.process ? 3 : 2} />
        ))}
        {['mu', 'bk'].map(id => (
          <line key={id} x1={cx(BOX[id])} y1={PB_Y} x2={cx(BOX[id])} y2={BOX[id].y} stroke={on(id) ? f.color : '#d1d5db'} strokeWidth={on(id) ? 3 : 2} />
        ))}
        {Object.entries(BOX).map(([id, b]) => (
          <g key={id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} fill={on(id) ? '#fff' : '#f9fafb'} stroke={on(id) ? f.color : '#9ca3af'} strokeWidth={on(id) ? 2 : 1} />
            <text x={cx(b)} y={b.y + b.h / 2 + 4} textAnchor="middle" fontSize={10} fontWeight={on(id) ? 700 : 400} fill={on(id) ? '#111827' : '#6b7280'}>{b.t}</text>
          </g>
        ))}
        {!f.crossesRouter && (
          <g stroke="#dc2626" strokeWidth={3}>
            <line x1={192} y1={84} x2={208} y2={98} /><line x1={192} y1={98} x2={208} y2={84} />
          </g>
        )}
      </svg>
      <p className="text-sm text-gray-700">{f.text}</p>
    </div>
  )
}
