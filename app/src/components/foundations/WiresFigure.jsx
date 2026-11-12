import { useState } from 'react'
import { useClock, lerp } from './anim.jsx'

// A hard-wired trip as an ANSI ladder rung, and the same trip in a digital
// substation, where copper remains only at the breaker. Slow motion.
const SENDS = [0, 0.6, 1.6, 3.6, 6.6, 9.6] // s after the trip: fast repeats, then steady
const TRAVEL = 1.2 // s from relay to breaker IED (slowed right down)
const OPEN = 2.6 // s from trip coil energized to 52a opening (slowed right down)
const RED = '#dc2626', GREY = '#9ca3af'

// ANSI normally-open contact: two plates; bridged when closed
function Contact({ x, y, closed, live, label }) {
  const c = live ? RED : '#374151'
  return (
    <g>
      <line x1={x - 5} y1={y - 9} x2={x - 5} y2={y + 9} stroke={c} strokeWidth={2} />
      <line x1={x + 5} y1={y - 9} x2={x + 5} y2={y + 9} stroke={c} strokeWidth={2} />
      {closed && <line x1={x - 5} y1={y} x2={x + 5} y2={y} stroke={c} strokeWidth={2.5} />}
      <text x={x} y={y - 14} textAnchor="middle" fontSize={9.5} fill="#374151">{label}</text>
      <text x={x} y={y + 22} textAnchor="middle" fontSize={8.5} fill={closed ? '#374151' : GREY}>{closed ? 'closed' : 'open'}</text>
    </g>
  )
}
function Coil({ x, y, live, label }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill={live ? '#fef2f2' : '#fff'} stroke={live ? RED : '#374151'} strokeWidth={2} />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fontWeight="700" fill={live ? RED : '#374151'}>TC</text>
      <text x={x} y={y - 16} textAnchor="middle" fontSize={9.5} fill="#374151">{label}</text>
    </g>
  )
}
// (+) rail, series elements, (−) rail; wire segments red while current flows
function Rung({ y, xL, xR, items, live }) {
  const pts = [xL, ...items.flatMap(it => [it.x - (it.coil ? 11 : 5), it.x + (it.coil ? 11 : 5)]), xR]
  const segs = []
  for (let i = 0; i < pts.length; i += 2) segs.push([pts[i], pts[i + 1]])
  return (
    <g>
      <line x1={xL} y1={y - 22} x2={xL} y2={y + 22} stroke="#374151" strokeWidth={2.5} />
      <line x1={xR} y1={y - 22} x2={xR} y2={y + 22} stroke="#374151" strokeWidth={2.5} />
      <text x={xL} y={y - 26} textAnchor="middle" fontSize={9} fill="#6b7280">(+)</text>
      <text x={xR} y={y - 26} textAnchor="middle" fontSize={9} fill="#6b7280">(−)</text>
      {segs.map(([a, b], i) => <line key={i} x1={a} y1={y} x2={b} y2={y} stroke={live ? RED : '#374151'} strokeWidth={live ? 2.5 : 1.5} />)}
      {items.map((it, i) => it.coil
        ? <Coil key={i} x={it.x} y={y} live={live} label={it.label} />
        : <Contact key={i} x={it.x} y={y} closed={it.closed} live={live} label={it.label} />)}
    </g>
  )
}
function Box({ x, y, w, h = 38, title, sub, color }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="#fff" stroke={color} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + 16} textAnchor="middle" fontSize={11} fontWeight="700" fill={color}>{title}</text>
      {sub && <text x={x + w / 2} y={y + 29} textAnchor="middle" fontSize={8.5} fill="#6b7280">{sub}</text>}
    </g>
  )
}

export default function WiresFigure() {
  const [tripped, setTripped] = useState(false)
  const t = useClock(tripped, tripped, 12)
  const on = tripped
  // Hard-wired
  const cuRelay = on, cu52a = !(on && t >= OPEN), cuLive = cuRelay && cu52a
  // Digital
  const delivered = on && t >= TRAVEL
  const dg52a = !(on && t >= TRAVEL + OPEN), dgLive = delivered && dg52a
  const relay = { x: 96, y: 132 }, sw = { x: 132, y: 132 }, swOut = { x: 196, y: 132 }, bkr = { x: 226, y: 132 }
  const dots = on ? SENDS.filter(s => t >= s && t <= s + TRAVEL).map(s => {
    const p = (t - s) / TRAVEL
    return p < 0.5 ? lerp(relay, sw, p * 2) : lerp(swOut, bkr, (p - 0.5) * 2)
  }) : []
  const caption = !on ? 'Press Trip.'
    : t < TRAVEL ? 'Hard-wired: the coil is energized the moment the contact closes. Digital: the message is on its way.'
    : t < OPEN ? 'Both trip coils energized. The digital trip message keeps repeating.'
    : t < TRAVEL + OPEN ? 'Hard-wired: the breaker opens and 52a breaks the trip-coil current. The digital breaker follows: its trip arrived later (about 2 ms later, in real time).'
    : 'Both breakers open; 52a has broken the trip-coil current in both. The trip message is still being repeated, less and less often.'
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 400 252" className="w-full h-auto max-w-xl" role="img" aria-label="Hard-wired trip circuit and digital trip path">
        <text x={4} y={14} fontSize={10.5} fontWeight="700" fill="#6b7280">HARD-WIRED TRIP CIRCUIT</text>
        <Rung y={62} xL={20} xR={384} live={cuLive} items={[
          { x: 110, label: 'Relay trip output', closed: cuRelay },
          { x: 220, label: '52a', closed: cu52a },
          { x: 310, label: '52 trip coil', coil: true },
        ]} />

        <text x={4} y={106} fontSize={10.5} fontWeight="700" fill="#6b7280">DIGITAL</text>
        <Box x={8} y={113} w={88} title="Relay IED" sub="publishes trip" color="#2563eb" />
        <line x1={96} y1={132} x2={132} y2={132} stroke={GREY} strokeWidth={3} />
        <Box x={132} y={118} w={64} h={28} title="Switch" color="#475569" />
        <line x1={196} y1={132} x2={226} y2={132} stroke={GREY} strokeWidth={3} />
        <Box x={226} y={113} w={100} title="Breaker IED" sub={delivered ? 'trip received' : 'listening'} color="#ea580c" />
        <line x1={250} y1={151} x2={250} y2={196} stroke="#ea580c" strokeDasharray="3 3" />
        <text x={256} y={176} fontSize={8.5} fill="#ea580c">drives</text>
        {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y - 1} r={5.5} fill="#2563eb" stroke="#fff" strokeWidth={1.5} />)}
        <Rung y={212} xL={196} xR={384} live={dgLive} items={[
          { x: 250, label: 'IED output', closed: delivered },
          { x: 300, label: '52a', closed: dg52a },
          { x: 352, label: '52 trip coil', coil: true },
        ]} />
        <text x={8} y={208} fontSize={8.5} fill="#6b7280">Copper stays only</text>
        <text x={8} y={219} fontSize={8.5} fill="#6b7280">at the breaker:</text>
      </svg>
      <p className="text-sm text-gray-700 min-h-[2.5rem]">{caption}</p>
      <div className="flex items-center gap-2">
        <button onClick={() => setTripped(x => !x)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${tripped ? 'bg-white text-gray-700 border-gray-300' : 'bg-red-600 text-white border-red-600'}`}>
          {tripped ? 'Reset' : 'Trip'}
        </button>
        <span className="text-xs text-gray-400">Slow motion: the real message takes about 2 ms end to end. Contacts drawn ANSI style.</span>
      </div>
    </div>
  )
}
