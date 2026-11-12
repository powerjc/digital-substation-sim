import { useEffect, useRef, useState } from 'react'
import { sampleAt, svRate, SV_CHANNELS } from '../lib/sv'
import { fmtTime } from '../lib/units'
import { fmtAppid } from '../lib/goose'
import { deviceColor } from '../lib/colors'
import { HelpLink } from './Help'

// Sampled Values as the relay receives them: waveforms up to the cursor (gaps
// where no samples arrive, flat where they are frozen) and the sample at the
// cursor decoded. Values are synthesized from phasors (lib/sv.js).

const PH = { A: '#b45309', B: '#111827', C: '#2563eb' }
const segAt = (segs, t) => segs.find(h => t >= h.t0 && t < h.t1) ?? segs.at(-1)

function Wave({ samples, chans, unit, scale, width, height, x0, tx }) {
  const max = Math.max(1, ...samples.flatMap(s => (s.arriving ? chans.map(c => Math.abs(s.values[c])) : [])))
  const y = v => height / 2 - (v / max) * (height / 2 - 4)
  return (
    <g>
      <line x1={x0} y1={height / 2} x2={width} y2={height / 2} stroke="#e5e7eb" />
      {chans.map(c => {
        let d = '', pen = false
        for (const s of samples) {
          if (!s.arriving) { pen = false; continue }
          d += `${pen ? 'L' : 'M'} ${tx(s.t).toFixed(1)} ${y(s.values[c]).toFixed(1)} `
          pen = true
        }
        return <path key={c} d={d} fill="none" stroke={PH[c.slice(1)]} strokeWidth={1.4} />
      })}
      <text x={x0 - 6} y={height / 2 + 3} textAnchor="end" fontSize={9} fill="#6b7280">±{(max / scale).toFixed(max / scale < 10 ? 1 : 0)} {unit}</text>
    </g>
  )
}

function Stream({ config, run, sub }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(700)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cb = config.svcbs.find(x => x.id === sub.sv)
  const segs = run.sim.svHealth?.[sub.id] ?? []
  const f = config.freqHz
  const rate = svRate(f)
  // Current at this merging unit stops when its own bay's breaker opens, or when the fault is cleared
  const muBay = config.ieds.find(d => d.id === cb.ied)?.bay
  const bkr = config.ieds.find(d => d.kind === 'breaker' && d.bay === muBay)
  const own = run.sim.events.find(e => e.kind === 'open' && e.dev === bkr?.id)?.t ?? null
  const cleared = run.sim.outcome.clearT ?? null
  const clearT = [own, cleared].filter(x => x !== null).reduce((m, x) => Math.min(m, x), Infinity)
  const ctx = { faultT: 0, clearT: Number.isFinite(clearT) ? clearT : null }
  const { zoom, time } = run
  const longView = zoom.id === 'heartbeats'
  const X0 = 46, H = 70
  const tx = t => X0 + ((t - zoom.t0) / (zoom.t1 - zoom.t0)) * (width - X0 - 4)
  const samples = []
  if (!longView) {
    for (let k = Math.ceil(zoom.t0 * rate); k / rate <= Math.min(time, zoom.t1); k++) {
      const t = k / rate
      samples.push(sampleAt(t, segAt(segs, t), ctx, f))
    }
  }
  const cur = sampleAt(time, segAt(segs, time), ctx, f)
  const h = segAt(segs, time)
  const usable = h.arriving && h.frozenAt === null && !h.invalid
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-gray-500">
        <span className="font-semibold" style={{ color: deviceColor(cb.ied) }}>{cb.ied}</span> → {sub.ied}: {rate} samples/s (80 per cycle), one sample every {(1e6 / rate).toFixed(0)} µs
      </div>
      <div ref={wrapRef} className="w-full">
        {longView ? (
          <p className="text-xs text-gray-400 py-3">Switch to a shorter view to see the samples: at this scale {rate} samples a second blur into a band.</p>
        ) : (
          <svg width={width} height={2 * H + 18} className="select-none" role="img" aria-label="Sampled values waveforms">
            <text x={4} y={14} fontSize={9.5} fontWeight="700" fill="#6b7280">I</text>
            <g><Wave samples={samples} chans={['IA', 'IB', 'IC']} unit="kA" scale={1000} width={width} height={H} x0={X0} tx={tx} /></g>
            <g transform={`translate(0 ${H + 14})`}>
              <text x={4} y={14} fontSize={9.5} fontWeight="700" fill="#6b7280">V</text>
              <Wave samples={samples} chans={['VA', 'VB', 'VC']} unit="kV" scale={1000} width={width} height={H} x0={X0} tx={tx} />
            </g>
            {segs.filter(s => !s.arriving || s.frozenAt !== null || s.invalid).map((s, i) => {
              const a = Math.max(zoom.t0, s.t0), b = Math.min(zoom.t1, s.t1, time)
              if (b <= a) return null
              return <rect key={i} x={tx(a)} y={0} width={tx(b) - tx(a)} height={2 * H + 14} fill="#dc2626" fillOpacity={0.07} />
            })}
            <line x1={tx(Math.min(time, zoom.t1))} y1={0} x2={tx(Math.min(time, zoom.t1))} y2={2 * H + 14} stroke="#111827" strokeDasharray="4 3" />
          </svg>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="font-semibold text-gray-700 mb-1">Sample at the cursor <span className="font-normal text-gray-400">({fmtTime(cur.t)})</span></div>
          {!h.arriving ? <div className="text-red-700 font-semibold">No samples arriving: {h.reason}</div> : (
            <table className="w-full">
              <tbody>
                <tr><td className="text-gray-500 pr-2">smpCnt</td><td className="font-mono">{cur.smpCnt}{cur.frozen && <span className="text-red-700"> (frozen)</span>}</td></tr>
                <tr><td className="text-gray-500 pr-2">smpSynch</td><td className="font-mono">{cur.smpSynch} <span className="text-gray-400">({cur.smpSynch === 2 ? 'global clock' : cur.smpSynch === 1 ? 'local clock' : 'not synchronized'})</span></td></tr>
                <tr><td className="text-gray-500 pr-2">quality</td><td className={`font-mono ${cur.quality === 'invalid' ? 'text-red-700 font-semibold' : ''}`}>{cur.quality}</td></tr>
                {SV_CHANNELS.map(c => (
                  <tr key={c}><td className="text-gray-500 pr-2">{c}</td><td className="font-mono">{(cur.values[c] / 1000).toFixed(2)} {c.startsWith('I') ? 'kA' : 'kV'}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <div className="font-semibold text-gray-700 mb-1">Every SV frame carries <HelpLink chapter="B1" /></div>
          <table className="w-full">
            <tbody>
              {[['Destination MAC', cb.mac], ['APPID', fmtAppid(cb.appid)], ['EtherType', '0x88BA'], ['svID', cb.svID], ['confRev', cb.confRev], ['noASDU', cb.noASDU], ['dataset', '4 currents, 4 voltages, each with quality']].map(([k, v]) => (
                <tr key={k}><td className="text-gray-500 pr-2">{k}</td><td className="font-mono break-all">{v}</td></tr>
              ))}
            </tbody>
          </table>
          <p className={`mt-2 ${usable ? 'text-green-700' : 'text-red-700 font-semibold'}`}>{usable ? `${sub.ied} uses these samples.` : `${sub.ied} cannot use these samples: protection blocked.`}</p>
        </div>
      </div>
    </div>
  )
}

export default function SVPanel({ config, run }) {
  const subs = config.svSubs ?? []
  const fault = config.script?.faultLine ?? 'AB'
  const relay = config.ieds.find(d => d.kind === 'relay' && (d.protects ?? d.line ?? d.bay) === fault)
  const deflt = subs.find(s => s.ied === relay?.id) ?? subs[0]
  const [pick, setPick] = useState(null)
  const sub = subs.find(s => s.id === pick) ?? deflt
  if (!subs.length) return null
  const muOf = s => config.svcbs.find(x => x.id === s.sv)?.ied
  return (
    <div className="flex flex-col gap-4">
      {subs.length > 1 && (
        <label className="text-xs text-gray-600 flex items-center gap-2">Stream
          <select value={sub.id} onChange={e => setPick(e.target.value)} className="border border-gray-300 rounded px-2 py-1 bg-white">
            {subs.map(s => <option key={s.id} value={s.id}>{muOf(s)} → {s.ied}</option>)}
          </select>
        </label>
      )}
      <Stream key={sub.id} config={config} run={run} sub={sub} />
      <p className="text-xs text-gray-400">Waveforms are synthesized from phasors (prefault load, a three-phase fault, nothing once this bay’s breaker has opened or the fault is cleared): they step between states, with no DC offset or transients, and every bay shows the same illustrative fault current. Primary values, illustrative 138 kV. The voltages come from the bay’s VTs, wired into the same merging unit; VT faults and a shared bus VT are not modelled.</p>
    </div>
  )
}
