import { useEffect, useState } from 'react'
import { deviceColor, SUB_STATUS } from '../lib/colors'
import { LINK_PRESETS, SUB_WRONG, countFailures } from '../lib/scenario'
import { parseEnd } from '../lib/network'
import { isActive } from '../lib/features'

// Device positions (viewBox units), side by side on wide screens and stacked
// on phones. Slice 1 is one bay; more bays add entries.
const LAYOUTS = {
  wide: {
    vb: [0, 24, 640, 146],
    '21-AB': { x: 8, y: 34, w: 196, h: 128 },
    SW1: { x: 262, y: 70, w: 116, h: 56 },
    '52-AB': { x: 436, y: 34, w: 196, h: 128 },
  },
  narrow: {
    vb: [0, 0, 340, 412],
    '21-AB': { x: 10, y: 4, w: 320, h: 128 },
    SW1: { x: 112, y: 178, w: 116, h: 56 },
    '52-AB': { x: 10, y: 280, w: 320, h: 128 },
  },
}

const center = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
function anchor(L, dev, toward) {
  const b = L[dev], c = center(b), o = center(L[toward])
  if (Math.abs(o.y - c.y) > Math.abs(o.x - c.x)) return { x: c.x, y: o.y > c.y ? b.y + b.h : b.y }
  return { x: o.x > c.x ? b.x + b.w : b.x, y: c.y }
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
  const LAYOUT = narrow ? LAYOUTS.narrow : LAYOUTS.wide
  const vertical = narrow

  // Frames in flight: a dot per hop, shown for a minimum visible time so
  // microsecond hops can be seen at playback speed.
  const vis = zoom.id === 'trip' ? 0.0012 : 0.05
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
    const a = parseEnd(l.a).dev, b = parseEnd(l.b).dev
    return { a: anchor(LAYOUT, a, b), b: anchor(LAYOUT, b, a), A: a, B: b }
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
  const subOf = id => state.subs[id]?.status

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Bay A–B</h3>
        <span className="text-xs text-gray-400">Tap a device or link to break it</span>
      </div>
      <svg viewBox={LAYOUT.vb.join(' ')} className="w-full h-auto select-none" role="img" aria-label="Station view: relay, switch and breaker IED">
        {/* Links */}
        {config.links.map(l => {
          const p = linkPts(l)
          const down = scenario.linkDown[l.id] !== undefined && time >= scenario.linkDown[l.id]
          const failing = scenario.linkDown[l.id] !== undefined || scenario.drops.some(d => d.link === l.id)
          const mx = (p.a.x + p.b.x) / 2, my = (p.a.y + p.b.y) / 2
          return (
            <g key={l.id} {...selectable('link', l.id)}>
              <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke="transparent" strokeWidth={22} />
              <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y}
                stroke={down ? '#dc2626' : isSel('link', l.id) ? '#4f46e5' : '#9ca3af'} strokeWidth={isSel('link', l.id) ? 4 : 3}
                strokeDasharray={down ? '6 4' : undefined} />
              <text x={vertical ? mx + 12 : mx} y={vertical ? my + 4 : p.a.y - 9} textAnchor={vertical ? 'start' : 'middle'} fontSize={10} fill={failing ? '#dc2626' : '#6b7280'} fontWeight={failing ? 700 : 400}>
                {l.id}{down ? ' DOWN' : ''}
              </text>
            </g>
          )
        })}

        {/* Switch */}
        {config.switches.map(sw => {
          const b = LAYOUT[sw.id]
          const baseSw = config.switches.find(x => x.id === sw.id)
          return (
            <g key={sw.id} {...selectable('switch', sw.id)}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill="#f8fafc"
                stroke={isSel('switch', sw.id) ? '#4f46e5' : deviceColor(sw.id)} strokeWidth={isSel('switch', sw.id) ? 2.5 : 1.25} />
              <text x={b.x + b.w / 2} y={b.y + 22} textAnchor="middle" fontSize={13} fontWeight="700" fill={deviceColor(sw.id)}>{sw.id}</text>
              <text x={b.x + b.w / 2} y={b.y + 37} textAnchor="middle" fontSize={9.5} fill="#6b7280">{sw.label}</text>
              {Object.entries(baseSw.ports).map(([port, pc]) => {
                const missing = scenario.vlanMissing.filter(v => v.sw === sw.id && String(v.port) === port)
                const l = config.links.find(x => x.a === `${sw.id}:${port}` || x.b === `${sw.id}:${port}`)
                const peer = l && parseEnd(l.a).dev === sw.id ? parseEnd(l.b).dev : parseEnd(l?.a ?? '').dev
                const left = peer && center(LAYOUT[peer]).x < center(b).x
                const above = peer && center(LAYOUT[peer]).y < center(b).y
                const px = vertical ? b.x + b.w + 6 : left ? b.x + 4 : b.x + b.w - 4
                const py = vertical ? (above ? b.y + 10 : b.y + b.h - 2) : b.y + b.h - 6
                return (
                  <g key={port}>
                    <text x={px} y={py} textAnchor={vertical || left ? 'start' : 'end'} fontSize={9} fill={missing.length ? '#dc2626' : '#6b7280'} fontWeight={missing.length ? 700 : 400}>
                      P{port}{detail || missing.length ? ` · ${pc.vlans.filter(v => !missing.some(m => m.vlan === v)).map(v => `V${v}`).join(',') || 'no VLAN'}` : ''}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}

        {/* IEDs */}
        {config.ieds.map(d => {
          const b = LAYOUT[d.id]
          const s = state.ieds[d.id]
          const color = deviceColor(d.id)
          const subs = config.subscriptions.filter(x => x.ied === d.id)
          const wrong = subs.some(x => scenario.subWrong[x.id])
          return (
            <g key={d.id} {...selectable('ied', d.id)}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill="#fff"
                stroke={isSel('ied', d.id) ? '#4f46e5' : color} strokeWidth={isSel('ied', d.id) ? 2.5 : 1.5} />
              <text x={b.x + 10} y={b.y + 19} fontSize={14} fontWeight="700" fill={color}>{d.id}</text>
              <text x={b.x + b.w - 10} y={b.y + 19} fontSize={10} fill="#6b7280" textAnchor="end">{d.label}{wrong ? ' ⚠' : ''}</text>
              {d.kind === 'relay' ? (
                <>
                  <Lamp x={b.x + 10} y={b.y + 44} on={s.trip} label="PTRC trip" />
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
            </g>
          )
        })}

        {/* Frames in flight */}
        {dots.map(({ f, h, p }) => {
          const [a, b] = hopPts(h)
          return <circle key={`${f.id}-${h.link}-${h.from}`} cx={a.x + (b.x - a.x) * p + (vertical && f.gocb.endsWith('Pos') ? 8 : 0)} cy={a.y + (b.y - a.y) * p + (!vertical ? (f.gocb.endsWith('Pos') ? 7 : -1) : 0)} r={5}
            fill={deviceColor(f.pub)} stroke="#fff" strokeWidth={1.5} />
        })}
        {crosses.map(({ f, h }) => {
          const [a, b] = hopPts(h)
          const k = h.fate === 'vlan' ? 0.15 : 0.5
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
    body = (
      <div className="flex flex-col gap-2">
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
    body = (
      <div className="flex flex-col gap-2">
        {subs.length === 0 && <span className="text-gray-500">No subscriptions.</span>}
        {subs.map(s => {
          const g = config.gocbs.find(x => x.id === s.gocb)
          const cur = scenario.subWrong[s.id] ?? ''
          const set = v => setScenario(sc => {
            const subWrong = { ...sc.subWrong }
            if (v) subWrong[s.id] = v
            else delete subWrong[s.id]
            return { ...sc, subWrong }
          })
          return (
            <label key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2">
              <span>Subscription to {g.label} ({g.ied})</span>
              <select value={cur} onChange={e => set(e.target.value)} className="border border-gray-300 rounded px-2 py-1 bg-white">
                <option value="">Engineered correctly</option>
                {Object.entries(SUB_WRONG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
