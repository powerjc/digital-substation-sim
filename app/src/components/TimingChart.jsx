import { useEffect, useRef, useState } from 'react'
import { deviceColor, FATE, SUB_STATUS } from '../lib/colors'
import { HelpLink } from './Help'

// Logic-analyzer style timing chart (adapted from the Line Protection
// Simulator). Digital traces for device signals, a tick per frame on each
// GOOSE lane (colored by its fate at the subscriber), and a status band per
// subscription. Drawn up to the current time so stepping reveals the run.

const LABEL_W = 104
const PAD_R = 12
const AXIS_H = 26
const ROW_H = 18
const LANE_H = 24
const GROUP_GAP = 8
const TICK_STEPS_MS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]

function segments(events, t0, endT, valueFn) {
  const out = []
  for (let i = 0; i < events.length; i++) {
    const a = Math.max(events[i].t, t0)
    const b = i + 1 < events.length ? events[i + 1].t : endT
    if (b < t0 || b <= a && i + 1 < events.length) continue
    const v = valueFn(events[i].state)
    const last = out[out.length - 1]
    if (last && last.v === v) last.t1 = b
    else out.push({ t0: a, t1: b, v })
  }
  return out
}

function buildRows(config, simCfg) {
  const rows = [{ key: 'fault', label: 'FAULT', type: 'digital', color: '#dc2626', fn: s => s.fault, group: null }]
  for (const d of config.ieds) {
    if (d.kind === 'testset') {
      for (const x of simCfg.gocbs.filter(y => y.ied === d.id)) rows.push({ key: `gocb-${x.id}`, label: 'Simulated', type: 'frames', gocb: x.id, color: deviceColor(d.id), group: d.id })
      continue
    }
    if (d.kind !== 'relay' && d.kind !== 'breaker') continue
    const g = d.id, color = deviceColor(d.id)
    const subs = config.subscriptions.filter(s => s.ied === d.id)
    const pubs = config.gocbs.filter(x => x.ied === d.id)
    const subRows = subs.map(s => ({ key: `sub-${s.id}`, label: `Sub ${config.gocbs.find(x => x.id === s.gocb).label}`, type: 'status', sub: s.id, group: g }))
    for (const s of (config.svSubs ?? []).filter(x => x.ied === d.id)) subRows.unshift({ key: `sv-${s.id}`, label: 'Sub SV', type: 'status', sub: s.id, sv: true, group: g })
    const pubRows = pubs.map(x => ({ key: `gocb-${x.id}`, label: `${x.label} GOOSE`, type: 'frames', gocb: x.id, color, group: g }))
    const prpRow = config.switches.some(s => s.lan) && d.kind !== 'testset'
      ? [{ key: `${g}-prp`, label: 'PRP LANs', type: 'prp', ied: g, group: g }] : []
    if (d.kind === 'relay') {
      rows.push({ key: `${g}-trip`, label: 'PTRC trip', type: 'digital', color, fn: s => s.ieds[g].trip, group: g })
      if (d.bf) rows.push({ key: `${g}-bf`, label: 'BF trip', type: 'digital', color: '#ea580c', fn: s => !!s.ieds[g].bf, group: g })
      rows.push(...pubRows, ...subRows, ...prpRow)
      rows.push({ key: `${g}-seen`, label: 'Sees bkr open', type: 'digital', color: '#16a34a', fn: s => s.ieds[g].seenPos === 'off', group: g })
    } else {
      rows.push(...subRows, ...prpRow)
      rows.push({ key: `${g}-coil`, label: 'Trip coil', type: 'digital', color, fn: s => s.ieds[g].coil, group: g })
      rows.push({ key: `${g}-52`, label: 'Breaker closed', type: 'digital', color: '#6b7280', fn: s => s.ieds[g].contactsClosed, group: g, breaker: true })
      rows.push(...pubRows)
    }
  }
  return rows
}

export default function TimingChart({ config, run, selectedFrame, onSelectFrame, controls }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(560, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { sim, time, zoom, setTime } = run
  const { events, frames } = sim
  const freqHz = config.freqHz
  const rows = buildRows(config, sim.config)

  let y = AXIS_H, prevGroup
  const layout = rows.map(r => {
    const first = r.group !== prevGroup
    if (first) { y += GROUP_GAP; prevGroup = r.group }
    const top = y
    y += r.type === 'frames' ? LANE_H : ROW_H
    return { ...r, top, h: r.type === 'frames' ? LANE_H : ROW_H, first }
  })
  const H = y + 6

  const { t0, t1 } = zoom
  const span = t1 - t0
  const plotW = width - LABEL_W - PAD_R
  const tx = t => LABEL_W + ((t - t0) / span) * plotW
  const now = Math.min(time, t1)
  const trip = zoom.id !== 'heartbeats'

  const stepMs = TICK_STEPS_MS.find(s => (span * 1000) / s <= Math.max(4, Math.floor(plotW / 80))) ?? 1000
  const ticks = []
  for (let i = Math.ceil((t0 * 1000 - 1e-6) / stepMs); i * stepMs <= t1 * 1000 + 1e-6; i++) ticks.push((i * stepMs) / 1000)

  const inWin = f => f.sendT >= t0 && f.sendT <= t1

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left, py = e.clientY - rect.top
    const t = t0 + ((px - LABEL_W) / plotW) * span
    if (t < t0 || t > t1) return
    const lane = layout.find(r => r.type === 'frames' && py >= r.top && py <= r.top + r.h)
    if (lane) {
      const cand = frames.filter(f => f.gocb === lane.gocb && inWin(f) && f.sendT <= now + 1e-9)
      const best = cand.reduce((b, f) => (!b || Math.abs(tx(f.sendT) - px) < Math.abs(tx(b.sendT) - px) ? f : b), null)
      if (best && Math.abs(tx(best.sendT) - px) < 12) { onSelectFrame(best.id); return }
    }
    setTime(t)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Timing<HelpLink chapter="B4" /></h3>
        {trip && <span className="text-xs text-gray-400">← 3 s quiet period: see Heartbeats</span>}
      </div>
      {controls && <div className="mb-2">{controls}</div>}
      <div ref={wrapRef} className="w-full overflow-x-auto">
        <svg width={width} height={H} className="select-none cursor-pointer" onClick={handleClick} role="img" aria-label="Timing chart">
          {t0 < 0 && <rect x={tx(t0)} y={AXIS_H - 4} width={Math.max(0, tx(Math.min(0, t1)) - tx(t0))} height={H - AXIS_H} fill="#f3f4f6" />}

          {ticks.map(t => (
            <g key={t}>
              <line x1={tx(t)} y1={AXIS_H - 4} x2={tx(t)} y2={H - 4} stroke="#eceef1" />
              <text x={tx(t)} y={11} textAnchor="middle" fontSize={10} fill="#6b7280">
                {trip ? `${Math.round(t * 1000)} ms` : `${(Math.round(t * 1000) / 1000).toFixed(stepMs >= 1000 ? 0 : 1)} s`}
              </text>
              {trip && <text x={tx(t)} y={22} textAnchor="middle" fontSize={9} fill="#b0b5bd">{(t * freqHz).toFixed(1)} cyc</text>}
            </g>
          ))}

          {layout.map(r => {
            const hi = r.top + 4, lo = r.top + r.h - 4
            const label = (
              <>
                {r.group && r.first && <text x={6} y={r.top + 12} fontSize={11} fontWeight="700" fill={deviceColor(r.group)}>{r.group}</text>}
                <text x={LABEL_W - 6} y={r.top + (r.type === 'frames' ? 15 : 12)} textAnchor="end" fontSize={10}
                  fill={r.key === 'fault' ? '#dc2626' : '#6b7280'} fontWeight={r.key === 'fault' || r.type === 'frames' ? 700 : 400}>{r.label}</text>
              </>
            )
            if (r.type === 'digital') {
              const segs = segments(events, t0, t1, r.fn).filter(s => s.t0 <= now).map(s => ({ ...s, t1: Math.min(s.t1, now) }))
              let d = ''
              segs.forEach((s, i) => {
                const yv = s.v ? hi : lo
                d += i === 0 ? `M ${tx(s.t0)} ${yv}` : ` L ${tx(s.t0)} ${yv}`
                d += ` L ${tx(s.t1)} ${yv}`
              })
              return (
                <g key={r.key}>
                  {label}
                  <line x1={LABEL_W} y1={lo} x2={width - PAD_R} y2={lo} stroke="#f3f4f6" />
                  {segs.filter(s => s.v).map((s, i) => (
                    <rect key={i} x={tx(s.t0)} y={hi} width={Math.max(0, tx(s.t1) - tx(s.t0))} height={lo - hi}
                      fill={r.breaker ? '#dc2626' : r.color} fillOpacity={r.breaker ? 0.12 : 0.22} />
                  ))}
                  <path d={d} fill="none" stroke={r.color} strokeWidth={1.75} />
                </g>
              )
            }
            if (r.type === 'prp') {
              const val = s => { const p = s.prp?.[r.ied]; if (!p) return 'ok'; const lost = ['A', 'B'].filter(x => p[x] !== 'ok'); return lost.length ? `LAN ${lost.join('+')} lost` : 'ok' }
              const segs = segments(events, t0, t1, val).filter(s => s.t0 <= now).map(s => ({ ...s, t1: Math.min(s.t1, now) }))
              return (
                <g key={r.key}>
                  {label}
                  {segs.map((s, i) => {
                    const ok = s.v === 'ok', w = Math.max(0, tx(s.t1) - tx(s.t0))
                    return (
                      <g key={i}>
                        <rect x={tx(s.t0)} y={ok ? lo - 3 : hi} width={w} height={ok ? 3 : lo - hi} fill={ok ? '#16a34a' : '#ea580c'} fillOpacity={ok ? 0.5 : 0.2} />
                        {!ok && w > 50 && <text x={tx(s.t0) + 4} y={lo - 2} fontSize={9} fontWeight="700" fill="#c2410c">{s.v}</text>}
                      </g>
                    )
                  })}
                </g>
              )
            }
            if (r.type === 'status') {
              const segs = segments(events, t0, t1, s => (r.sv ? s.sv?.[r.sub]?.status ?? 'healthy' : s.subs[r.sub]?.status ?? 'none')).filter(s => s.t0 <= now).map(s => ({ ...s, t1: Math.min(s.t1, now) }))
              return (
                <g key={r.key}>
                  {label}
                  {segs.map((s, i) => {
                    const st = SUB_STATUS[s.v]
                    if (s.v === 'none') return <text key={i} x={tx(s.t0) + 4} y={lo - 2} fontSize={9} fill={st.color}>not configured</text>
                    const ok = s.v === 'healthy'
                    const w = Math.max(0, tx(s.t1) - tx(s.t0))
                    return (
                      <g key={i}>
                        <rect x={tx(s.t0)} y={ok ? lo - 3 : hi} width={w} height={ok ? 3 : lo - hi} fill={st.color} fillOpacity={ok ? 0.5 : 0.2} />
                        {!ok && w > 40 && <text x={tx(s.t0) + 4} y={lo - 2} fontSize={9} fontWeight="700" fill={st.color}>{st.label}</text>}
                      </g>
                    )
                  })}
                </g>
              )
            }
            // Frame lane
            const fr = frames.filter(f => f.gocb === r.gocb && inWin(f) && f.sendT <= now + 1e-9)
            let lastLabelX = -Infinity
            return (
              <g key={r.key}>
                {label}
                <line x1={LABEL_W} y1={r.top + r.h - 3} x2={width - PAD_R} y2={r.top + r.h - 3} stroke="#e5e7eb" />
                {fr.map(f => {
                  const x = tx(f.sendT)
                  const fate = Object.values(f.rx)[0]?.fate ?? 'inFlight'
                  const c = FATE[fate]?.color ?? '#9ca3af'
                  const big = f.pdu.sqNum === 0
                  const showLabel = x - lastLabelX >= 30
                  if (showLabel) lastLabelX = x
                  const selected = f.id === selectedFrame
                  return (
                    <g key={f.id}>
                      {selected && <rect x={x - 4} y={r.top + 1} width={8} height={r.h - 3} rx={2} fill="#4f46e5" fillOpacity={0.2} />}
                      <line x1={x} y1={r.top + (big ? 3 : 9)} x2={x} y2={r.top + r.h - 3} stroke={c} strokeWidth={big ? 2.5 : 1.75} />
                      {showLabel && <text x={x + 2.5} y={r.top + 9} fontSize={8.5} fill="#6b7280">{f.pdu.stNum}/{f.pdu.sqNum}</text>}
                    </g>
                  )
                })}
              </g>
            )
          })}

          <line x1={tx(now)} y1={AXIS_H - 4} x2={tx(now)} y2={H - 4} stroke="#111827" strokeWidth={1} strokeDasharray="4 3" />
        </svg>
      </div>
      <p className="text-xs text-gray-400">
        Frame ticks: <span style={{ color: FATE.new.color }}>■</span> new state accepted · <span style={{ color: FATE.repeat.color }}>■</span> repeat ·{' '}
        <span style={{ color: FATE.ignored.color }}>■</span> ignored · <span style={{ color: FATE.rejected.color }}>■</span> rejected ·{' '}
        <span style={{ color: FATE.lost.color }}>■</span> lost. Labels are stNum/sqNum. Tap a tick to decode it; tap elsewhere to jump in time.
      </p>
    </div>
  )
}
