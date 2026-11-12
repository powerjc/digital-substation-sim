import { useMemo, useState } from 'react'
import {
  SCL_FILES, sclExcerpt, WHERE_LIVES, COMMISSIONING_STEPS, MISSES,
  stampedSequence, phaseDeg, falseDiff, ILLUSTRATIVE_SLOPE, bestMaster, CLOCK_CLASS,
  protectionUnderSync, OSCILLATORS, holdoverError, secondsTo,
} from '../../lib/figures'
import { fmtTime, fmtDur } from '../../lib/units'
import { Seg } from './anim.jsx'

const MISS_BY_ID = Object.fromEntries(MISSES.map(m => [m.id, m]))

// ── D1: the SCL files and their flow ──
export function SclFigure() {
  const [sel, setSel] = useState('scd')
  const f = SCL_FILES.find(x => x.id === sel)
  const Chip = ({ id }) => {
    const x = SCL_FILES.find(y => y.id === id)
    return (
      <button onClick={() => setSel(id)} className={`rounded-lg border-2 px-2 py-1 text-sm font-bold ${sel === id ? 'border-indigo-500 bg-indigo-50 text-indigo-900' : 'border-gray-300 bg-white text-gray-700 hover:border-gray-500'}`}>
        {x.name}
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
        <Chip id="ssd" /><span>+</span><Chip id="icd" /><span>→ system configurator →</span><Chip id="scd" /><span>→ IED configurators →</span><Chip id="cid" />
        <span className="w-full sm:w-auto">returned:</span><Chip id="iid" /><span>between projects:</span><Chip id="sed" />
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <div className="font-semibold text-gray-900">{f.name}: {f.full}</div>
        <div className="text-xs text-gray-500">From {f.from} to {f.to}. Copper equivalent: {f.like}</div>
        <div className="mt-1 text-gray-800">{f.what}</div>
      </div>
      <pre className="text-[11px] leading-snug bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto"><code>{sclExcerpt(sel)}</code></pre>
      <p className="text-xs text-gray-400">Excerpts built from the simulator’s own configuration; trimmed (…) to the parts that matter here.</p>
    </div>
  )
}

// ── D2: where each value lives ──
export function WhereLivesFigure({ onOpenSim }) {
  return (
    <div className="flex flex-col gap-1.5">
      {WHERE_LIVES.map((r, i) => {
        const m = r.miss && MISS_BY_ID[r.miss]
        return (
          <div key={i} className="rounded-lg border border-gray-200 px-3 py-2 text-sm flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <div className="sm:w-56 shrink-0 font-semibold text-gray-900">{r.value}</div>
            <div className="flex-1 text-gray-700">{r.where}</div>
            {m?.scenario && onOpenSim && (
              <button onClick={() => onOpenSim({ panel: 'bay', scenario: m.scenario })} className="self-start shrink-0 text-xs px-2 py-1 rounded border border-indigo-300 text-indigo-700 hover:border-indigo-500">
                Break it →
              </button>
            )}
          </div>
        )
      })}
      <p className="text-xs text-gray-400">“Break it” opens the bay simulator with that copy wrong. Play the run, then check the bay view and the decoded frames.</p>
    </div>
  )
}

// ── D3: which commissioning step catches which miss ──
export function CommissioningFigure({ onOpenSim }) {
  const [miss, setMiss] = useState('appid')
  const m = MISS_BY_ID[miss]
  return (
    <div className="flex flex-col gap-2">
      <select value={miss} onChange={e => setMiss(e.target.value)} className="self-start border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-sm" aria-label="Miss">
        {MISSES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      <ol className="flex flex-col gap-1">
        {COMMISSIONING_STEPS.map((s, i) => {
          const hit = m.caughtBy.includes(s.id)
          return (
            <li key={s.id} className={`rounded-lg border px-3 py-1.5 text-sm ${hit ? 'border-green-300 bg-green-50' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-baseline gap-2">
                <span className={`font-bold ${hit ? 'text-green-700' : 'text-gray-300'}`}>{hit ? '✓' : '·'}</span>
                <span className={`font-semibold ${hit ? 'text-gray-900' : 'text-gray-500'}`}>{i + 1}. {s.label}</span>
                {hit && <span className="text-xs font-semibold text-green-700">catches it</span>}
              </div>
              <div className="text-xs text-gray-600 pl-5">{s.how}</div>
            </li>
          )
        })}
      </ol>
      {m.scenario && onOpenSim && (
        <button onClick={() => onOpenSim({ panel: 'bay', scenario: m.scenario })} className="self-start text-sm px-3 py-1 rounded-lg border border-indigo-300 text-indigo-700 hover:border-indigo-500">See this miss in the simulator →</button>
      )}
      {!m.scenario && <p className="text-xs text-gray-500">Test mode arrives in the simulator with slice 1.1.</p>}
    </div>
  )
}

// ── E1: two clocks, one sequence of events ──
const OFFSETS = [{ id: 0, label: 'Clocks agree' }, { id: -0.005, label: '52-AB 5 ms behind' }, { id: -0.05, label: '52-AB 50 ms behind' }]
export function ClockOffsetFigure() {
  const [off, setOff] = useState(-0.005)
  const r = useMemo(() => stampedSequence(off), [off])
  return (
    <div className="flex flex-col gap-2">
      <Seg options={OFFSETS} value={off} onChange={setOff} />
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200"><th className="py-1 pr-2 font-semibold">Recorded time</th><th className="py-1 pr-2 font-semibold">Event (as the record shows it)</th><th className="py-1 font-semibold text-right">Really</th></tr></thead>
        <tbody>
          {r.rows.map(x => (
            <tr key={x.label} className="border-b border-gray-50">
              <td className="py-1 pr-2 font-mono whitespace-nowrap">{fmtTime(x.stampT)}</td>
              <td className="py-1 pr-2">{x.label} <span className="text-xs text-gray-400">({x.dev} clock)</span></td>
              <td className="py-1 font-mono text-right text-gray-400 whitespace-nowrap">{fmtTime(x.trueT)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={`rounded-lg border px-3 py-2 text-sm ${r.misordered ? 'bg-red-50 border-red-200 text-red-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
        {r.misordered ? 'Out of order: the record shows the breaker acting before the relay tripped. The protection worked; the clocks didn’t agree.' : 'In order. Latencies read straight off the record: trip to coil is the transfer time.'}
      </div>
    </div>
  )
}

// ── E2: time error is phase error ──
const DTS = [{ id: 1e-6, label: '1 µs' }, { id: 1e-5, label: '10 µs' }, { id: 1e-4, label: '100 µs' }, { id: 1e-3, label: '1 ms' }, { id: 2e-3, label: '2 ms' }]
export function PhaseFigure() {
  const [dt, setDt] = useState(1e-3)
  const th = phaseDeg(dt), id = falseDiff(dt)
  const N = 120, W = 360, X0 = 30, H = 40
  const wave = (shiftDeg, sign, amp = 1) => Array.from({ length: N + 1 }, (_, i) => {
    const a = (i / N) * 2 * 360
    return `${i ? 'L' : 'M'} ${X0 + (i / N) * W} ${H + 18 - sign * amp * H * Math.sin(((a - shiftDeg) * Math.PI) / 180)}`
  }).join(' ')
  // difference current (A side + B side, B side reversed and late)
  const diff = Array.from({ length: N + 1 }, (_, i) => {
    const a = ((i / N) * 2 * 360 * Math.PI) / 180
    const v = Math.sin(a) - Math.sin(a - (th * Math.PI) / 180)
    return `${i ? 'L' : 'M'} ${X0 + (i / N) * W} ${158 - v * H}`
  }).join(' ')
  const trips = id > ILLUSTRATIVE_SLOPE
  return (
    <div className="flex flex-col gap-2">
      <Seg options={DTS} value={dt} onChange={setDt} />
      <svg viewBox="0 0 400 210" className="w-full h-auto max-w-xl" role="img" aria-label="Current from two merging units with a time offset">
        <text x={4} y={14} fontSize={10} fontWeight="700" fill="#6b7280">CURRENT IN (side A) AND OUT (side B, sampled {fmtDur(dt)} late)</text>
        <line x1={X0} y1={H + 18} x2={X0 + W} y2={H + 18} stroke="#e5e7eb" />
        <path d={wave(0, 1)} fill="none" stroke="#2563eb" strokeWidth={2} />
        <path d={wave(th, 1)} fill="none" stroke="#ea580c" strokeWidth={2} strokeDasharray="5 3" />
        <text x={4} y={118} fontSize={10} fontWeight="700" fill="#6b7280">WHAT THE DIFFERENTIAL SEES (should be zero)</text>
        <line x1={X0} y1={158} x2={X0 + W} y2={158} stroke="#e5e7eb" />
        <line x1={X0} y1={158 - ILLUSTRATIVE_SLOPE * H} x2={X0 + W} y2={158 - ILLUSTRATIVE_SLOPE * H} stroke="#dc2626" strokeDasharray="3 3" />
        <text x={X0 + W} y={158 - ILLUSTRATIVE_SLOPE * H - 3} textAnchor="end" fontSize={8.5} fill="#dc2626">30 % slope (illustrative)</text>
        <path d={diff} fill="none" stroke={trips ? '#dc2626' : '#16a34a'} strokeWidth={2} />
      </svg>
      <div className={`rounded-lg border px-3 py-2 text-sm ${trips ? 'bg-red-50 border-red-200 text-red-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
        Time error {fmtDur(dt)} → phase error {th < 0.1 ? th.toFixed(4) : th.toFixed(1)}° → false differential {(id * 100).toFixed(id < 0.01 ? 2 : 0)} % of the through current.
        {trips ? ' Above the slope: the relay trips for an external fault.' : ' Well inside the restraint.'}
      </div>
    </div>
  )
}

// ── E3: grandmaster selection ──
const START_CLOCKS = [
  { id: 'GM1', priority1: 128, priority2: 1, state: 'locked', failed: false },
  { id: 'GM2', priority1: 128, priority2: 2, state: 'locked', failed: false },
]
const STATE_TEXT = { locked: 'locked to GPS', holdover: 'GPS lost: holdover', free: 'free-running' }
export function ClocksFigure() {
  const [clocks, setClocks] = useState(START_CLOCKS)
  const gm = bestMaster(clocks)
  const set = (id, patch) => setClocks(cs => cs.map(c => (c.id === id ? { ...c, ...patch } : c)))
  const xs = { GM1: 90, GM2: 310 }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {clocks.map(c => (
          <div key={c.id} className="flex flex-wrap gap-1">
            <button onClick={() => set(c.id, { state: c.state === 'locked' ? 'holdover' : 'locked' })} className="px-2.5 py-1 rounded-lg text-sm border border-gray-300 bg-white hover:border-gray-500">{c.id}: {c.state === 'locked' ? 'cut GPS' : 'restore GPS'}</button>
            <button onClick={() => set(c.id, { failed: !c.failed })} className="px-2.5 py-1 rounded-lg text-sm border border-gray-300 bg-white hover:border-gray-500">{c.id}: {c.failed ? 'repair' : 'fail'}</button>
          </div>
        ))}
        <button onClick={() => setClocks(START_CLOCKS)} className="px-2.5 py-1 rounded-lg text-sm text-gray-500">Start over</button>
      </div>
      <svg viewBox="0 0 400 230" className="w-full h-auto max-w-xl" role="img" aria-label="PTP clock tree">
        {clocks.map(c => {
          const x = xs[c.id], active = gm === c.id
          return (
            <g key={c.id}>
              <text x={x} y={14} textAnchor="middle" fontSize={9} fill={c.state === 'locked' && !c.failed ? '#16a34a' : '#9ca3af'}>GPS antenna {c.state === 'locked' && !c.failed ? '✓' : '✗'}</text>
              <line x1={x} y1={18} x2={x} y2={34} stroke={c.state === 'locked' ? '#16a34a' : '#d1d5db'} strokeWidth={2} strokeDasharray={c.state === 'locked' ? undefined : '3 3'} />
              <rect x={x - 70} y={34} width={140} height={44} rx={6} fill={c.failed ? '#f3f4f6' : active ? '#eef2ff' : '#fff'} stroke={active ? '#4f46e5' : '#9ca3af'} strokeWidth={active ? 2.5 : 1.25} />
              <text x={x} y={50} textAnchor="middle" fontSize={11} fontWeight="700" fill="#111827">{c.id}{active ? ': grandmaster' : ''}</text>
              <text x={x} y={64} textAnchor="middle" fontSize={9} fill="#6b7280">{c.failed ? 'failed' : `${STATE_TEXT[c.state]} · class ${CLOCK_CLASS[c.state]}`}</text>
              <text x={x} y={74} textAnchor="middle" fontSize={8.5} fill="#9ca3af">priority1 {c.priority1}, priority2 {c.priority2}</text>
              <line x1={x} y1={78} x2={200} y2={110} stroke={active ? '#4f46e5' : '#d1d5db'} strokeWidth={active ? 3 : 1.5} />
            </g>
          )
        })}
        <rect x={140} y={110} width={120} height={32} rx={6} fill="#f8fafc" stroke="#475569" />
        <text x={200} y={124} textAnchor="middle" fontSize={10.5} fontWeight="700" fill="#475569">Switch</text>
        <text x={200} y={136} textAnchor="middle" fontSize={8.5} fill="#6b7280">transparent clock</text>
        {['Merging unit', '21-AB', '52-AB'].map((n, i) => {
          const x = 70 + i * 130
          return (
            <g key={n}>
              <line x1={200} y1={142} x2={x} y2={180} stroke={gm ? '#4f46e5' : '#d1d5db'} strokeWidth={gm ? 2.5 : 1.5} />
              <rect x={x - 55} y={180} width={110} height={30} rx={5} fill="#fff" stroke="#9ca3af" />
              <text x={x} y={199} textAnchor="middle" fontSize={10} fill="#374151">{n}</text>
            </g>
          )
        })}
        <text x={200} y={226} textAnchor="middle" fontSize={9} fill={gm ? '#6b7280' : '#dc2626'}>{gm ? `Everything follows ${gm}` : 'No grandmaster: every IED runs on its own clock'}</text>
      </svg>
      <p className="text-xs text-gray-400">Simplified comparison: priority1 first (set by the engineer, equal here), then clock class (lower is better), then priority2.</p>
    </div>
  )
}

// ── E4: sync status and protection ──
const SMP = [{ id: 2, label: '2 global' }, { id: 1, label: '1 local' }, { id: 0, label: '0 none' }]
export function SyncFigure() {
  const [smp, setSmp] = useState({ AX: 2, AB: 2, AT: 2 })
  const res = protectionUnderSync(smp)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {['AX', 'AB', 'AT'].map(m => (
          <div key={m} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-28 font-semibold text-gray-800">Merging unit {m}</span>
            <span className="text-xs text-gray-500">smpSynch</span>
            <Seg options={SMP} value={smp[m]} onChange={v => setSmp(s => ({ ...s, [m]: v }))} />
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        {res.map(f => (
          <div key={f.id} className={`rounded-lg border px-3 py-2 text-sm ${f.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <div className="font-semibold">{f.label} <span className={f.ok ? 'text-green-700' : 'text-red-700'}>{f.ok ? 'in service' : 'BLOCKED'}</span></div>
            <div className="text-xs text-gray-500">uses MU {f.uses.join(', ')}</div>
            <div className="text-xs text-gray-700 mt-0.5">{f.why}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">Typical behaviour; vendors differ in detail (some allow a short hold-off before blocking).</p>
    </div>
  )
}

// ── E5: holdover ──
const PERIODS = [{ s: 1, label: '1 s' }, { s: 60, label: '1 min' }, { s: 3600, label: '1 h' }, { s: 86400, label: '1 day' }]
export function HoldoverFigure() {
  const [osc, setOsc] = useState('ocxo')
  const o = OSCILLATORS.find(x => x.id === osc)
  const t1 = secondsTo(o.ppm, 1e-6)
  const fmtSpan = s => (s < 120 ? `${Math.round(s)} s` : s < 7200 ? `${(s / 60).toFixed(0)} min` : `${(s / 3600).toFixed(1)} h`)
  return (
    <div className="flex flex-col gap-2">
      <Seg options={OSCILLATORS.map(x => ({ id: x.id, label: x.label }))} value={osc} onChange={setOsc} />
      <div className="text-sm text-gray-700">Frequency error {o.ppm} ppm (illustrative). Passes 1 µs after <b>{fmtSpan(t1)}</b>.</div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 text-left border-b border-gray-200"><th className="py-1 font-semibold">Time since GPS lost</th><th className="py-1 font-semibold">Time error</th><th className="py-1 font-semibold">Within 1 µs?</th></tr></thead>
        <tbody>
          {PERIODS.map(p => {
            const e = holdoverError(o.ppm, p.s)
            const ok = e <= 1e-6 + 1e-15
            return (
              <tr key={p.s} className="border-b border-gray-50">
                <td className="py-1">{p.label}</td>
                <td className="py-1 font-mono">{fmtDur(e)}</td>
                <td className={`py-1 font-semibold ${ok ? 'text-green-700' : 'text-red-700'}`}>{ok ? 'yes' : 'no'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-gray-400">Simplified: constant frequency error, no ageing or temperature effects. Within one station, devices following the same grandmaster drift together.</p>
    </div>
  )
}
