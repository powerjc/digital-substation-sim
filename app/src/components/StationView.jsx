import { useEffect, useState } from 'react'
import { deviceColor, SUB_STATUS } from '../lib/colors'
import { LINK_PRESETS, SUB_WRONG, IED_MODES, countFailures } from '../lib/scenario'
import { parseEnd } from '../lib/network'
import { isActive } from '../lib/features'
import { HelpLink } from './Help'

// Device positions (viewBox units). Control house to yard: gateway, station
// bus SB, relays, process bus PB, breaker IEDs. Left to right on wide screens,
// top to bottom on phones. The buses are drawn as bars; links meet them square.
const LAYOUTS = {
  wide: {
    vb: [0, 0, 640, 200],
    GW: { x: 6, y: 64, w: 118, h: 72 },
    SB: { x: 146, y: 12, w: 26, h: 176, bar: true },
    '21-AB': { x: 196, y: 36, w: 196, h: 128 },
    PB: { x: 416, y: 12, w: 26, h: 176, bar: true },
    '52-AB': { x: 466, y: 36, w: 168, h: 128 },
    TS: { x: 379, y: 200, w: 100, h: 34 },
  },
  wide2: {
    vb: [0, 0, 640, 328],
    GW: { x: 6, y: 128, w: 118, h: 72 },
    SB: { x: 146, y: 8, w: 26, h: 312, bar: true },
    '21-AB': { x: 196, y: 12, w: 196, h: 144 },
    '21-AX': { x: 196, y: 172, w: 196, h: 144 },
    PB: { x: 416, y: 8, w: 26, h: 312, bar: true },
    '52-AB': { x: 466, y: 12, w: 168, h: 144 },
    '52-AX': { x: 466, y: 172, w: 168, h: 144 },
    TS: { x: 379, y: 332, w: 100, h: 34 },
  },
  narrow: {
    vb: [0, 0, 340, 440],
    GW: { x: 100, y: 4, w: 140, h: 52 },
    SB: { x: 10, y: 76, w: 320, h: 22, bar: true },
    '21-AB': { x: 10, y: 120, w: 320, h: 128 },
    PB: { x: 10, y: 270, w: 250, h: 22, bar: true },
    '52-AB': { x: 10, y: 314, w: 320, h: 122 },
    TS: { x: 268, y: 262, w: 66, h: 38 },
  },
  narrow2: {
    vb: [0, 0, 340, 492],
    GW: { x: 100, y: 4, w: 140, h: 52 },
    SB: { x: 4, y: 74, w: 332, h: 22, bar: true },
    '21-AB': { x: 4, y: 118, w: 162, h: 144 },
    '21-AX': { x: 174, y: 118, w: 162, h: 144 },
    PB: { x: 4, y: 284, w: 268, h: 22, bar: true },
    '52-AB': { x: 4, y: 328, w: 162, h: 160 },
    '52-AX': { x: 174, y: 328, w: 162, h: 160 },
    TS: { x: 278, y: 276, w: 58, h: 38 },
  },
}

const center = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const hBar = b => !!b.bar && b.w > b.h
const vBar = b => !!b.bar && b.h > b.w
function anchor(L, dev, toward) {
  const b = L[dev], c = center(b), t = L[toward], o = center(t)
  // A box beside the end of a bar (same row or column): join end to side
  if (hBar(b) && o.y >= b.y && o.y <= b.y + b.h) return { x: o.x < c.x ? b.x : b.x + b.w, y: c.y }
  if (vBar(b) && o.x >= b.x && o.x <= b.x + b.w) return { x: c.x, y: o.y < c.y ? b.y : b.y + b.h }
  if (hBar(t) && c.y >= t.y && c.y <= t.y + t.h) return { x: o.x < c.x ? b.x : b.x + b.w, y: o.y }
  if (vBar(t) && c.x >= t.x && c.x <= t.x + t.w) return { x: o.x, y: o.y < c.y ? b.y : b.y + b.h }
  // A bus bar: meet the other box square, at its centre line
  if (hBar(b)) return { x: clamp(o.x, b.x + 8, b.x + b.w - 8), y: o.y < c.y ? b.y : b.y + b.h }
  if (vBar(b)) return { x: o.x < c.x ? b.x : b.x + b.w, y: clamp(o.y, b.y + 8, b.y + b.h - 8) }
  // A box facing a bar: leave from the side that faces it
  if (hBar(t)) return { x: c.x, y: o.y < c.y ? b.y : b.y + b.h }
  if (vBar(t)) return { x: o.x < c.x ? b.x : b.x + b.w, y: c.y }
  if (Math.abs(o.y - c.y) > Math.abs(o.x - c.x)) return { x: c.x, y: o.y > c.y ? b.y + b.h : b.y }
  return { x: o.x > c.x ? b.x + b.w : b.x, y: c.y }
}

// PRP: split the process-bus bar into LAN A and LAN B, side by side
function splitPB(L) {
  const pb = L.PB
  if (!pb) return L
  const out = { ...L }
  delete out.PB
  if (pb.h > pb.w) {
    out.PBA = { ...pb, x: pb.x - 4, w: 16 }
    out.PBB = { ...pb, x: pb.x + 16, w: 16 }
    if (out.TS) out.TS = { ...out.TS, x: out.PBA.x + 8 - out.TS.w / 2 }
  } else {
    out.PBA = { ...pb, y: pb.y - 4, h: 14 }
    out.PBB = { ...pb, y: pb.y + 14, h: 14 }
    if (out.TS) out.TS = { ...out.TS, y: out.PBA.y + 7 - out.TS.h / 2 }
  }
  return out
}

function useNarrow() {
  const q = '(max-width: 639px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const fn = e => setNarrow(e.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  return narrow
}

const POS_TEXT = { on: 'closed', off: 'open', intermediate: 'moving', bad: 'bad' }

function SubBadge({ x, y, label, status }) {
  const s = SUB_STATUS[status] ?? SUB_STATUS.noMsg
  return (
    <g>
      <text x={x} y={y} fontSize={10} fill="#6b7280">{label}</text>
      <rect x={x + 92} y={y - 10} width={58} height={14} rx={3} fill={s.color} fillOpacity={0.15} stroke={s.color} strokeWidth={0.75} />
      <text x={x + 121} y={y} fontSize={9.5} fontWeight="700" fill={s.color} textAnchor="middle">{s.label}</text>
    </g>
  )
}

function Lamp({ x, y, on, color = '#dc2626', label }) {
  return (
    <g>
      <circle cx={x + 5} cy={y - 3.5} r={4.5} fill={on ? color : '#fff'} stroke={on ? color : '#9ca3af'} />
      <text x={x + 14} y={y} fontSize={10.5} fill="#374151">{label}</text>
    </g>
  )
}

export default function StationView({ config, run }) {
  const [sel, setSel] = useState(null) // { type: 'link' | 'ied' | 'switch', id }
  const { state, time, sim, scenario, setScenario, zoom } = run
  const detail = isActive(config, 'networkDetail')
  const nFail = countFailures(scenario)
  const narrow = useNarrow()
  const two = config.ieds.some(d => d.id === '21-AX')
  const prpOn = config.switches.some(x => x.id === 'PBA')
  const LAYOUT0 = (L => (prpOn ? splitPB(L) : L))(LAYOUTS[(narrow ? 'narrow' : 'wide') + (two ? '2' : '')])
  // The view box ends below the lowest device present (the test set only with test mode)
  const present = [...config.ieds.map(d => d.id), ...config.switches.map(x => x.id)].filter(id => LAYOUT0[id])
  const LAYOUT = { ...LAYOUT0, vb: [0, 0, LAYOUT0.vb[2], Math.max(...present.map(id => LAYOUT0[id].y + LAYOUT0[id].h)) + 6] }
  const isVert = (a, b) => Math.abs(a.y - b.y) > Math.abs(a.x - b.x)
  const testOn = isActive(config, 'testMode')

  // Frames in flight: a dot per hop, shown for a minimum visible time so
  // microsecond hops can be seen at playback speed.
  const vis = zoom.id === 'trip' ? 0.0012 : zoom.id === 'bf' ? 0.003 : 0.05
  const dots = [], crosses = []
  for (const f of sim.frames) {
    if (f.sendT > time || f.sendT < time - 2 * vis - 0.001) continue
    for (const h of f.hops) {
      if (time < h.t0) continue
      const age = time - h.t0
      if (h.fate === 'ok' && age <= vis) dots.push({ f, h, p: Math.min(1, age / vis) })
      if (h.fate !== 'ok' && age <= 2 * vis) crosses.push({ f, h })
    }
  }
  const linkPts = l => {
    const ea = parseEnd(l.a), eb = parseEnd(l.b)
    const a = anchor(LAYOUT, ea.dev, eb.dev), b = anchor(LAYOUT, eb.dev, ea.dev)
    // PRP: a device's LAN A and LAN B links run side by side
    const lan = [ea.port, eb.port].map(p => String(p ?? '')).find(p => /(^|\.)[AB]$/.test(p))
    if (prpOn && lan) {
      const off = lan.endsWith('A') ? -5 : 5
      if (isVert(a, b)) { a.x += off; b.x += off } else { a.y += off; b.y += off }
    }
    return { a, b, A: ea.dev, B: eb.dev }
  }
  const hopPts = h => {
    const l = config.links.find(x => x.id === h.link)
    const p = linkPts(l)
    return h.from === p.A ? [p.a, p.b] : [p.b, p.a]
  }

  const selectable = (type, id) => ({
    onClick: () => setSel(s => (s?.type === type && s.id === id ? null : { type, id })),
    style: { cursor: 'pointer' },
  })
  const isSel = (type, id) => sel?.type === type && sel.id === id
  const subOf = id => state.subs[id]?.status ?? 'none'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">{two ? 'Bus A: bays A–B and A–X' : 'Bay A–B'}<HelpLink chapter="A1" /></h3>
        <span className="text-xs text-gray-400">Tap a device or link to break it</span>
      </div>
      <svg viewBox={LAYOUT.vb.join(' ')} className="w-full h-auto select-none" role="img" aria-label="Station view: relay, switch and breaker IED">
        {/* Links */}
        {config.links.map(l => {
          const p = linkPts(l)
          const swDown = [p.A, p.B].some(x => scenario.switchDown[x] !== undefined && time >= scenario.switchDown[x])
          const down = (scenario.linkDown[l.id] !== undefined && time >= scenario.linkDown[l.id]) || swDown
          const failing = scenario.linkDown[l.id] !== undefined || scenario.drops.some(d => d.link === l.id)
          const mx = (p.a.x + p.b.x) / 2, my = (p.a.y + p.b.y) / 2
          const vertical = isVert(p.a, p.b)
          return (
            <g key={l.id} {...selectable('link', l.id)}>
              <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke="transparent" strokeWidth={22} />
              <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y}
                stroke={down ? '#dc2626' : isSel('link', l.id) ? '#4f46e5' : '#9ca3af'} strokeWidth={isSel('link', l.id) ? 4 : 3}
                strokeDasharray={down ? '6 4' : undefined} />
              {(!prpOn || detail || !/[AB]$/.test(l.id) || failing) && <text x={vertical ? mx - 6 : mx} y={vertical ? my + 4 : p.a.y + 13} textAnchor={vertical ? 'end' : 'middle'} fontSize={10} fill={failing ? '#dc2626' : '#6b7280'} fontWeight={failing ? 700 : 400}>
                {l.id}{down && !swDown ? ' DOWN' : ''}
              </text>}
            </g>
          )
        })}

        {/* Switches, drawn as bus bars */}
        {config.switches.map(sw => {
          const b = LAYOUT[sw.id]
          if (!b) return null
          const dead = scenario.switchDown[sw.id] !== undefined && time >= scenario.switchDown[sw.id]
          const c = center(b), vert = vBar(b)
          const stroke = isSel('switch', sw.id) ? '#4f46e5' : dead ? '#dc2626' : deviceColor(sw.id)
          return (
            <g key={sw.id} {...selectable('switch', sw.id)}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} fill={dead ? '#fef2f2' : '#e2e8f0'}
                stroke={stroke} strokeWidth={isSel('switch', sw.id) ? 2.5 : 1.25} />
              <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={Math.min(b.w, b.h) < 20 ? 9.5 : 11} fontWeight="700" fill={dead ? '#dc2626' : sw.lan ? deviceColor(sw.id) : '#334155'}
                transform={vert ? `rotate(-90 ${c.x} ${c.y})` : undefined}>
                {sw.id} · {dead ? 'FAILED' : sw.label}
              </text>
              {Object.entries(sw.ports).map(([port, pc]) => {
                const missing = scenario.vlanMissing.filter(v => v.sw === sw.id && String(v.port) === port)
                const l = config.links.find(x => x.a === `${sw.id}:${port}` || x.b === `${sw.id}:${port}`)
                const peer = l && parseEnd(l.a).dev === sw.id ? parseEnd(l.b).dev : parseEnd(l?.a ?? '').dev
                if (!peer || !LAYOUT[peer]) return null
                if (sw.lan && !detail && !missing.length) return null // PRP bars: port numbers only with network detail
                const lp = linkPts(l)
                const a = lp.A === sw.id ? lp.a : lp.b
                const right = vert && a.x >= b.x + b.w - 1
                const below = !vert && a.y >= b.y + b.h - 1
                const px = vert ? (right ? a.x + 3 : a.x - 3) : a.x + 4
                const py = vert ? a.y - 4 : below ? a.y + 11 : a.y - 3
                return (
                  <text key={port} x={px} y={py} textAnchor={vert && !right ? 'end' : 'start'} fontSize={8.5}
                    fill={missing.length ? '#dc2626' : '#64748b'} fontWeight={missing.length ? 700 : 400}>
                    P{port}{detail || missing.length ? ` ${pc.vlans.filter(v => !missing.some(m => m.vlan === v)).map(v => `V${v}`).join(',') || 'no VLAN'}` : ''}
                  </text>
                )
              })}
            </g>
          )
        })}

        {/* IEDs */}
        {config.ieds.map(d => {
          const b = LAYOUT[d.id]
          if (!b) return null
          const s = state.ieds[d.id]
          if (d.kind === 'testset') {
            const on = !!scenario.testSet
            return (
              <g key={d.id} {...selectable('ied', d.id)}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill={on ? '#faf5ff' : '#fff'} stroke={isSel('ied', d.id) ? '#4f46e5' : deviceColor(d.id)} strokeWidth={1.5} strokeDasharray={on ? undefined : '4 3'} />
                <text x={b.x + b.w / 2} y={b.y + 15} textAnchor="middle" fontSize={10.5} fontWeight="700" fill={deviceColor(d.id)}>Test set</text>
                <text x={b.x + b.w / 2} y={b.y + 28} textAnchor="middle" fontSize={8.5} fill="#6b7280">{on ? 'simulating' : 'idle'}</text>
              </g>
            )
          }
          if (d.kind === 'hmi') {
            return (
              <g key={d.id} {...selectable('ied', d.id)}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill="#fff" stroke={isSel('ied', d.id) ? '#4f46e5' : deviceColor(d.id)} strokeWidth={1.5} />
                <text x={b.x + b.w / 2} y={b.y + 19} textAnchor="middle" fontSize={12} fontWeight="700" fill={deviceColor(d.id)}>{d.label}</text>
                <text x={b.x + b.w / 2} y={b.y + 34} textAnchor="middle" fontSize={9} fill="#6b7280">MMS to SCADA</text>
                <text x={b.x + b.w / 2} y={b.y + 46} textAnchor="middle" fontSize={8.5} fill="#9ca3af">(not simulated yet)</text>
              </g>
            )
          }
          const color = deviceColor(d.id)
          const subs = config.subscriptions.filter(x => x.ied === d.id)
          const wrong = subs.some(x => scenario.subWrong[x.id] || scenario.subMissing.includes(x.id))
          const mode = scenario.iedMode[d.id]
          const simOn = scenario.simMode.includes(d.id)
          const stuck = scenario.breakerStuck.includes(d.id)
          return (
            <g key={d.id} {...selectable('ied', d.id)}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill="#fff"
                stroke={isSel('ied', d.id) ? '#4f46e5' : color} strokeWidth={isSel('ied', d.id) ? 2.5 : 1.5} />
              <text x={b.x + 10} y={b.y + 19} fontSize={14} fontWeight="700" fill={color}>{d.id}</text>
              <text x={b.x + b.w - 10} y={b.y + 19} fontSize={10} fill="#6b7280" textAnchor="end">{d.label}{wrong ? ' ⚠' : ''}</text>
              {mode && mode !== 'on' && (
                <g>
                  <rect x={b.x + b.w - 74} y={b.y + 26} width={64} height={14} rx={3} fill="#a855f7" fillOpacity={0.15} stroke="#a855f7" strokeWidth={0.75} />
                  <text x={b.x + b.w - 42} y={b.y + 36} textAnchor="middle" fontSize={9} fontWeight="700" fill="#7e22ce">{mode === 'test' ? 'TEST' : 'TEST/BLK'}</text>
                </g>
              )}
              {simOn && (
                <g>
                  <rect x={b.x + b.w - 74} y={mode && mode !== 'on' ? b.y + 44 : b.y + 26} width={64} height={14} rx={3} fill="#a855f7" fillOpacity={0.25} stroke="#7e22ce" strokeWidth={0.75} />
                  <text x={b.x + b.w - 42} y={(mode && mode !== 'on' ? b.y + 44 : b.y + 26) + 10} textAnchor="middle" fontSize={9} fontWeight="700" fill="#6b21a8">SIM MODE</text>
                </g>
              )}
              {stuck && (
                <g transform={`translate(0 ${(mode && mode !== 'on') || simOn ? 0 : -18})`}>
                  <rect x={b.x + b.w - 74} y={b.y + 44} width={64} height={14} rx={3} fill="#dc2626" fillOpacity={0.12} stroke="#dc2626" strokeWidth={0.75} />
                  <text x={b.x + b.w - 42} y={b.y + 54} textAnchor="middle" fontSize={9} fontWeight="700" fill="#dc2626">STUCK</text>
                </g>
              )}
              {d.kind === 'relay' ? (
                <>
                  <Lamp x={b.x + 10} y={b.y + 44} on={s.trip} label="PTRC trip" />
                  {d.bf && <Lamp x={b.x + 90} y={b.y + 44} on={s.bf} color="#ea580c" label="BF" />}
                  <text x={b.x + 10} y={b.y + 66} fontSize={10.5} fill="#374151">
                    sees breaker: <tspan fontWeight="700">{s.seenPos ? POS_TEXT[s.seenPos] : '—'}</tspan>
                    {subOf(subs[0]?.id) !== 'healthy' && s.seenPos ? <tspan fill="#dc2626"> (stale)</tspan> : null}
                  </text>
                </>
              ) : (
                <>
                  <Lamp x={b.x + 10} y={b.y + 44} on={s.coil} label="Trip coil" />
                  <g>
                    <rect x={b.x + 10} y={b.y + 55} width={10} height={10} fill={s.contactsClosed ? '#dc2626' : '#16a34a'} />
                    <text x={b.x + 24} y={b.y + 64} fontSize={10.5} fill="#374151">
                      Breaker <tspan fontWeight="700">{s.contactsClosed ? 'CLOSED' : 'OPEN'}</tspan>
                    </text>
                  </g>
                </>
              )}
              {subs.map((x, i) => (
                <SubBadge key={x.id} x={b.x + 10} y={b.y + 96 + i * 18}
                  label={`Sub ${config.gocbs.find(g => g.id === x.gocb).label}`} status={subOf(x.id)} />
              ))}
              <text x={b.x + 10} y={b.y + b.h - 8} fontSize={9} fill="#9ca3af">
                pub {config.gocbs.filter(g => g.ied === d.id).map(g => g.label).join(', ')}
              </text>
              {state.prp?.[d.id] && (
                <text x={b.x + b.w - 10} y={b.y + b.h - 8} fontSize={9} textAnchor="end" fontWeight="700">
                  <tspan fill="#6b7280" fontWeight="400">PRP </tspan>
                  <tspan fill={state.prp[d.id].A === 'ok' ? '#16a34a' : '#dc2626'}>A{state.prp[d.id].A === 'ok' ? '✓' : '✗'}</tspan>
                  <tspan fill={state.prp[d.id].B === 'ok' ? '#16a34a' : '#dc2626'}> B{state.prp[d.id].B === 'ok' ? '✓' : '✗'}</tspan>
                </text>
              )}
            </g>
          )
        })}

        {/* Frames in flight */}
        {dots.map(({ f, h, p }) => {
          const [a, b] = hopPts(h)
          const vertical = isVert(a, b), off = f.gocb.endsWith('Pos') ? 7 : f.gocb.endsWith('BF') ? -8 : 0
          return <circle key={`${f.id}-${h.link}-${h.from}`} cx={a.x + (b.x - a.x) * p + (vertical ? off : 0)} cy={a.y + (b.y - a.y) * p + (vertical ? 0 : off)} r={5}
            fill={deviceColor(f.pub)} stroke="#fff" strokeWidth={1.5} />
        })}
        {crosses.map(({ f, h }) => {
          const [a, b] = hopPts(h)
          const k = h.fate === 'vlan' ? 0.15 : 0.5
          const vertical = isVert(a, b)
          const x = a.x + (b.x - a.x) * k + (vertical ? -14 : 0)
          const y = a.y + (b.y - a.y) * k + (vertical ? 0 : 14)
          return (
            <g key={`x${f.id}-${h.link}-${h.from}`} stroke="#dc2626" strokeWidth={3}>
              <line x1={x - 6} y1={y - 6} x2={x + 6} y2={y + 6} />
              <line x1={x - 6} y1={y + 6} x2={x + 6} y2={y - 6} />
            </g>
          )
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={nFail ? 'font-semibold text-red-700' : 'text-gray-400'}>
          {nFail ? `${nFail} failure${nFail > 1 ? 's' : ''} injected` : 'No failures injected'}
        </span>
        {nFail > 0 && (
          <button onClick={() => setScenario({})} className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:border-gray-500">Clear all</button>
        )}
      </div>

      {sel && <FailurePanel config={config} sel={sel} scenario={scenario} setScenario={setScenario} onClose={() => setSel(null)} />}
    </div>
  )
}

function FailurePanel({ config, sel, scenario, setScenario, onClose }) {
  const title = sel.type === 'link'
    ? (() => { const l = config.links.find(x => x.id === sel.id); return `Link ${l.id}: ${parseEnd(l.a).dev} ↔ ${parseEnd(l.b).dev}` })()
    : sel.type === 'switch' ? `Switch ${sel.id}` : `${sel.id} (${config.ieds.find(d => d.id === sel.id).label})`

  let body = null
  if (sel.type === 'link') {
    const cur = scenario.linkDown[sel.id]
    const preset = LINK_PRESETS.find(p => (p.t === null ? cur === undefined : p.t === cur))?.id ?? 'up'
    const setPreset = id => setScenario(sc => {
      const linkDown = { ...sc.linkDown }
      const p = LINK_PRESETS.find(x => x.id === id)
      if (p.t === null) delete linkDown[sel.id]
      else linkDown[sel.id] = p.t
      return { ...sc, linkDown }
    })
    body = (
      <div className="flex flex-col gap-2">
        <label className="flex items-center justify-between gap-2">
          <span>Link state</span>
          <select value={preset} onChange={e => setPreset(e.target.value)} className="border border-gray-300 rounded px-2 py-1 bg-white">
            {LINK_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {config.gocbs.map(g => {
          const drop = { link: sel.id, gocb: g.id, st: 2, sq: 0 }
          const on = scenario.drops.some(d => d.link === drop.link && d.gocb === drop.gocb && d.st === 2 && d.sq === 0)
          const toggle = () => setScenario(sc => ({
            ...sc,
            drops: on ? sc.drops.filter(d => !(d.link === drop.link && d.gocb === drop.gocb && d.st === 2 && d.sq === 0)) : [...sc.drops, drop],
          }))
          return (
            <label key={g.id} className="flex items-center gap-2">
              <input type="checkbox" checked={on} onChange={toggle} />
              <span>Lose the first {g.label} frame after the fault (stNum 2, sqNum 0)</span>
            </label>
          )
        })}
      </div>
    )
  } else if (sel.type === 'switch') {
    const sw = config.switches.find(x => x.id === sel.id)
    const cur = scenario.switchDown[sw.id]
    const preset = LINK_PRESETS.find(p => (p.t === null ? cur === undefined : p.t === cur))?.id ?? 'up'
    const setPreset = id => setScenario(sc => {
      const switchDown = { ...sc.switchDown }
      const p = LINK_PRESETS.find(x => x.id === id)
      if (p.t === null) delete switchDown[sw.id]
      else switchDown[sw.id] = p.t
      return { ...sc, switchDown }
    })
    body = (
      <div className="flex flex-col gap-2">
        <label className="flex items-center justify-between gap-2">
          <span>Switch</span>
          <select value={preset} onChange={e => setPreset(e.target.value)} className="border border-gray-300 rounded px-2 py-1 bg-white">
            {LINK_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {Object.entries(sw.ports).flatMap(([port, pc]) => pc.vlans.map(vlan => {
          const missing = scenario.vlanMissing.some(v => v.sw === sw.id && String(v.port) === port && v.vlan === vlan)
          const toggle = () => setScenario(sc => ({
            ...sc,
            vlanMissing: missing ? sc.vlanMissing.filter(v => !(v.sw === sw.id && String(v.port) === port && v.vlan === vlan))
              : [...sc.vlanMissing, { sw: sw.id, port: Number(port), vlan }],
          }))
          return (
            <label key={`${port}-${vlan}`} className="flex items-center gap-2">
              <input type="checkbox" checked={!missing} onChange={toggle} />
              <span>Port {port} carries VLAN {vlan}</span>
            </label>
          )
        }))}
      </div>
    )
  } else {
    const subs = config.subscriptions.filter(s => s.ied === sel.id)
    const ied = config.ieds.find(d => d.id === sel.id)
    const mode = scenario.iedMode[sel.id] ?? 'on'
    const setMode = v => setScenario(sc => {
      const iedMode = { ...sc.iedMode }
      if (v === 'on') delete iedMode[sel.id]
      else iedMode[sel.id] = v
      return { ...sc, iedMode }
    })
    const stuck = scenario.breakerStuck.includes(sel.id)
    const toggleStuck = () => setScenario(sc => ({ ...sc, breakerStuck: stuck ? sc.breakerStuck.filter(x => x !== sel.id) : [...sc.breakerStuck, sel.id] }))
    body = (
      <div className="flex flex-col gap-2">
        {ied.kind === 'testset' && (
          <>
            <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
              <span>Publishes</span>
              <select value={scenario.testSet?.imitate ?? ''} onChange={e => setScenario(sc => ({ ...sc, testSet: e.target.value ? { imitate: e.target.value, tripAt: sc.testSet?.tripAt ?? null } : null }))}
                className="border border-gray-300 rounded px-2 py-1 bg-white">
                <option value="">Nothing (idle)</option>
                {config.gocbs.filter(g => g.entries.some(x => x.signal === 'trip')).map(g => <option key={g.id} value={g.id}>A simulated {g.label} of {g.ied}</option>)}
              </select>
            </label>
            {scenario.testSet && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={scenario.testSet.tripAt !== null} onChange={e => setScenario(sc => ({ ...sc, testSet: { ...sc.testSet, tripAt: e.target.checked ? -1.0 : null } }))} />
                <span>Inject a simulated trip 1 s before the fault</span>
              </label>
            )}
            <span className="text-xs text-gray-500">Simulated messages carry the simulation flag. Only IEDs in simulation mode use them.</span>
          </>
        )}
        {ied.kind === 'hmi' && <span className="text-gray-500">The gateway talks MMS to SCADA, which the simulator doesn’t model yet. Fail the station-bus switch to see that protection doesn’t depend on it.</span>}
        {isActive(config, 'testMode') && (ied.kind === 'relay' || ied.kind === 'breaker') && (
          <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
            <span>Mode (Mod/Beh)</span>
            <select value={mode} onChange={e => setMode(e.target.value)} className="border border-gray-300 rounded px-2 py-1 bg-white">
              {IED_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        )}
        {isActive(config, 'testMode') && (ied.kind === 'relay' || ied.kind === 'breaker') && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={scenario.simMode.includes(sel.id)}
              onChange={() => setScenario(sc => ({ ...sc, simMode: sc.simMode.includes(sel.id) ? sc.simMode.filter(x => x !== sel.id) : [...sc.simMode, sel.id] }))} />
            <span>Simulation mode (LPHD.Sim): take messages from a test set</span>
          </label>
        )}
        {ied.kind === 'breaker' && isActive(config, 'secondBay') && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={stuck} onChange={toggleStuck} />
            <span>Breaker stuck: the trip coil energizes but the mechanism doesn’t move</span>
          </label>
        )}
        {subs.length === 0 && (ied.kind === 'relay' || ied.kind === 'breaker') && <span className="text-gray-500">No subscriptions.</span>}
        {subs.map(s => {
          const g = config.gocbs.find(x => x.id === s.gocb)
          const cur = scenario.subMissing.includes(s.id) ? 'missing' : scenario.subWrong[s.id] ?? ''
          const set = v => setScenario(sc => {
            const subWrong = { ...sc.subWrong }
            delete subWrong[s.id]
            if (v && v !== 'missing') subWrong[s.id] = v
            const subMissing = sc.subMissing.filter(x => x !== s.id)
            if (v === 'missing') subMissing.push(s.id)
            return { ...sc, subWrong, subMissing }
          })
          return (
            <label key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
              <span>Subscription to {g.label} ({g.ied})</span>
              <select value={cur} onChange={e => set(e.target.value)} className="border border-gray-300 rounded px-2 py-1 bg-white">
                <option value="">Engineered correctly</option>
                {Object.entries(SUB_WRONG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                <option value="missing">Not configured at all</option>
              </select>
            </label>
          )
        })}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-sm text-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-indigo-900">{title}</span>
        <button onClick={onClose} className="text-indigo-400 hover:text-indigo-700 text-lg leading-none px-1" title="Close">×</button>
      </div>
      {body}
    </div>
  )
}
