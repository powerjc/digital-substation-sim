import { useMemo, useState } from 'react'
import { MESSAGE_KINDS, parseReference, LN_TABLE, publishSchedule, SUB_CASES, subscribePipeline, TEST_MATRIX } from '../../lib/figures'
import { defaultConfig, PROFILES } from '../../lib/schema'
import { fmtAppid } from '../../lib/goose'
import { Seg } from './anim.jsx'

// ── B1: three kinds of message ──
const KIND_ROWS = [['replaces', 'Replaces'], ['pattern', 'Pattern'], ['who', 'Who talks'], ['rate', 'How often'], ['speed', 'How fast'], ['layer', 'Network']]
export function KindsFigure() {
  return (
    <div className="grid sm:grid-cols-3 gap-2">
      {MESSAGE_KINDS.map(k => (
        <div key={k.id} className="rounded-lg border-2 px-3 py-2" style={{ borderColor: k.color }}>
          <div className="font-bold mb-1" style={{ color: k.color }}>{k.name}</div>
          <dl className="text-xs flex flex-col gap-1">
            {KIND_ROWS.map(([f, label]) => (
              <div key={f}><dt className="text-gray-400 uppercase tracking-wider text-[10px]">{label}</dt><dd className="text-gray-800">{k[f]}</dd></div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

// ── B2: a full reference, taken apart ──
const PART_INFO = {
  ied: { label: 'IED name', color: '#2563eb', text: 'The physical device: here the line relay for bay A–B. Set in configuration, unique in the substation.' },
  ld: { label: 'Logical device', color: '#7c3aed', text: 'A group of functions inside the IED. PROT holds the protection functions; a breaker IED might have CTRL.' },
  prefix: { label: 'Prefix', color: '#6b7280', text: 'An optional label in front of the class, to tell similar functions apart.' },
  lnClass: { label: 'Logical node class', color: '#dc2626', text: 'The function, in four letters. PTRC is trip conditioning: it gathers the trips of the protection functions into one trip output (the 94).' },
  lnInst: { label: 'Instance', color: '#dc2626', text: 'Which one, when an IED has several of the same function: PTRC1, PTRC2…' },
  do: { label: 'Data object', color: '#ea580c', text: 'One piece of information the function has. Tr is the trip; other functions have Str (start / pickup), Op (operate), Pos (position).' },
  da: { label: 'Data attribute', color: '#16a34a', text: 'One value of the data object. general = tripped, any phase (there are also phsA, phsB, phsC). Other common ones: stVal (state), q (quality), t (time).' },
}
export function NameFigure() {
  const cfg = useMemo(defaultConfig, [])
  const ied = cfg.ieds.find(d => d.id === '21-AB')
  const parts = parseReference(ied.name, 'LineProtABPROT/PTRC1.Tr.general')
  const [sel, setSel] = useState('lnClass')
  const info = PART_INFO[sel]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end font-mono text-base sm:text-lg leading-none">
        {parts.map((p, i) => p.kind === 'sep' ? <span key={i} className="px-0.5 pb-1 text-gray-400">{p.text}</span> : (
          <button key={i} onClick={() => setSel(p.kind)}
            className={`px-1 pt-1 pb-1 rounded border-b-4 ${sel === p.kind ? 'bg-gray-100' : ''}`}
            style={{ borderColor: PART_INFO[p.kind].color, color: sel === p.kind ? PART_INFO[p.kind].color : '#111827' }}>
            {p.text}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <span className="font-semibold" style={{ color: info.color }}>{info.label}: </span>{info.text}
      </div>
      <p className="text-xs text-gray-400">Tap each part. In the frame, this name appears only in the subscriber’s configuration; the frame carries the value (B3).</p>
    </div>
  )
}
export function LnTableFigure() {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Device numbers and logical nodes</div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-200"><th className="py-1 pr-2 font-semibold">ANSI</th><th className="py-1 pr-2 font-semibold">Function</th><th className="py-1 font-semibold">Logical node</th></tr></thead>
        <tbody>
          {LN_TABLE.map(r => (
            <tr key={r.ln} className="border-b border-gray-50">
              <td className="py-1 pr-2 font-semibold text-gray-800 whitespace-nowrap">{r.dev}</td>
              <td className="py-1 pr-2 text-gray-700">{r.fn}</td>
              <td className="py-1 font-mono text-red-700 whitespace-nowrap">{r.ln}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-1">A common mapping, not one to one: a multifunction relay has many logical nodes, and an 86 lockout has no logical node of its own (Part C).</p>
    </div>
  )
}

// ── B3: control block and frame ──
export function GocbFigure() {
  const cfg = useMemo(defaultConfig, [])
  const g = cfg.gocbs.find(x => x.id === 'AB.Trip')
  const prof = PROFILES.typical
  const [edited, setEdited] = useState(false)
  const [sel, setSel] = useState('datSet')
  const entries = edited ? [...g.entries, { ref: 'PROT/PDIS1.Op.general', type: 'BOOLEAN' }] : g.entries
  const confRev = edited ? 2 : 1
  const CFG = [
    { id: 'gocbRef', label: 'Name (gocbRef)', value: g.gocbRef },
    { id: 'goID', label: 'goID', value: g.goID },
    { id: 'datSet', label: 'Dataset', value: g.datSet.split('$').pop(), list: entries.map(e => e.ref.split('/').pop()) },
    { id: 'confRev', label: 'confRev', value: confRev },
    { id: 'times', label: 'Fastest repeat / heartbeat', value: `${prof.intervalsMs[0]} ms / ${prof.heartbeatMs} ms` },
    { id: 'addr', label: 'Address: MAC, APPID, VLAN, priority', value: `${g.mac}, ${fmtAppid(g.appid)}, VLAN ${g.vlan.id}, prio ${g.vlan.priority}` },
  ]
  const FRAME = [
    { id: 'addr', label: 'Destination MAC, VLAN tag, APPID', value: `${g.mac} · VLAN ${g.vlan.id}/${g.vlan.priority} · ${fmtAppid(g.appid)}` },
    { id: 'gocbRef', label: 'gocbRef', value: g.gocbRef },
    { id: 'times', label: 'timeAllowedtoLive', value: '4 ms … 2000 ms (from the repeat pattern)' },
    { id: 'datSet', label: 'datSet', value: g.datSet },
    { id: 'goID', label: 'goID', value: g.goID },
    { id: 'state', label: 't, stNum, sqNum', value: 'set by the publisher as it runs (B4)' },
    { id: 'confRev', label: 'confRev', value: confRev },
    { id: 'datSet', label: 'numDatSetEntries', value: entries.length, k: 'n' },
    { id: 'datSet', label: 'allData', value: entries.map(e => (e.type === 'Quality' ? 'good' : 'true')).join(', '), k: 'all', note: 'values only, in dataset order: no names' },
  ]
  const Item = ({ f, side }) => {
    const on = f.id === sel
    return (
      <button onClick={() => setSel(f.id)} className={`w-full text-left px-2 py-1 rounded border text-xs ${on ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-400'}`}>
        <div className="text-gray-500">{f.label}</div>
        <div className="font-mono text-gray-900 break-all">{String(f.value)}</div>
        {f.list && <ol className="font-mono text-gray-700 list-decimal pl-5">{f.list.map((x, i) => <li key={i}>{x}</li>)}</ol>}
        {f.note && on && <div className="text-indigo-700 font-semibold">{f.note}</div>}
        {side === 'cfg' && f.id === 'confRev' && edited && <div className="text-orange-700">dataset edited: confRev went up</div>}
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-1.5 text-sm text-gray-700">
        <input type="checkbox" checked={edited} onChange={e => setEdited(e.target.checked)} />
        Edit the dataset: add the distance operate signal
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Control block (configuration)</div>
          {CFG.map(f => <Item key={f.id} f={f} side="cfg" />)}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">In every frame</div>
          {FRAME.map((f, i) => <Item key={i} f={f} side="frame" />)}
        </div>
      </div>
      {edited && <p className="text-sm text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">The frame now carries three values and confRev 2. A breaker IED still configured for confRev 1 rejects it: its configuration says value 1 is the trip and expects two values.</p>}
      <p className="text-xs text-gray-400">Tap a setting to see where it ends up in the frame.</p>
    </div>
  )
}

// ── B4: publishing pattern ──
export function PublishFigure() {
  const [zoom, setZoom] = useState('burst')
  const [twice, setTwice] = useState(false)
  const untilS = zoom === 'burst' ? 0.07 : 3.2
  const frames = publishSchedule({ changes: twice ? [0, 0.04] : [0], untilS })
  const X0 = 24, W = 346
  const tx = t => X0 + (t / untilS) * W
  const ticks = zoom === 'burst' ? [0, 10, 20, 30, 40, 50, 60, 70].map(m => m / 1000) : [0, 1, 2, 3]
  let lastX = -Infinity
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Seg options={[{ id: 'burst', label: 'First 70 ms' }, { id: 'long', label: 'First 3 s' }]} value={zoom} onChange={setZoom} />
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <input type="checkbox" checked={twice} onChange={e => setTwice(e.target.checked)} />
          Value changes again at 40 ms
        </label>
      </div>
      <svg viewBox="0 0 400 128" className="w-full h-auto max-w-xl" role="img" aria-label="GOOSE frames after a change">
        <line x1={X0} y1={86} x2={X0 + W} y2={86} stroke="#9ca3af" />
        {ticks.map(t => (
          <g key={t}>
            <line x1={tx(t)} y1={86} x2={tx(t)} y2={91} stroke="#9ca3af" />
            <text x={tx(t)} y={103} textAnchor="middle" fontSize={9} fill="#6b7280">{zoom === 'burst' ? `${Math.round(t * 1000)} ms` : `${t} s`}</text>
          </g>
        ))}
        {[0, ...(twice ? [0.04] : [])].filter(c => c <= untilS).map(c => (
          <g key={c}>
            <line x1={tx(c)} y1={18} x2={tx(c)} y2={86} stroke="#dc2626" strokeDasharray="3 3" />
            <text x={tx(c) + 3} y={14} fontSize={9} fontWeight="700" fill="#dc2626">change</text>
          </g>
        ))}
        {frames.map((f, i) => {
          const x = tx(f.t)
          const show = x - lastX >= 22
          if (show) lastX = x
          return (
            <g key={i}>
              <line x1={x} y1={f.sq === 0 ? 30 : 46} x2={x} y2={86} stroke={f.st === 3 ? '#7c3aed' : '#2563eb'} strokeWidth={f.sq === 0 ? 3 : 2} />
              {show && <text x={x + 2} y={f.sq === 0 ? 28 : 44} fontSize={9} fill="#374151">{f.st}/{f.sq}</text>}
              {show && <text x={x + 2} y={78} fontSize={8} fill="#9ca3af">{f.tal}</text>}
            </g>
          )
        })}
        <text x={X0} y={120} fontSize={9} fill="#6b7280">Labels: stNum/sqNum above, TAL (ms) below</text>
      </svg>
    </div>
  )
}

// ── B5: subscriber checks ──
const RESULT = {
  pass: { icon: '✓', cls: 'text-green-700' },
  fail: { icon: '✗', cls: 'text-red-700' },
  skip: { icon: '–', cls: 'text-gray-400' },
}
const OUT = { good: 'bg-green-50 border-green-200 text-green-900', info: 'bg-gray-50 border-gray-200 text-gray-800', warn: 'bg-yellow-50 border-yellow-200 text-yellow-900', bad: 'bg-red-50 border-red-200 text-red-900' }
export function SubscribeFigure() {
  const [c, setC] = useState('new')
  const r = useMemo(() => subscribePipeline(c), [c])
  return (
    <div className="flex flex-col gap-2">
      <select value={c} onChange={e => setC(e.target.value)} className="self-start border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-sm" aria-label="Case">
        {SUB_CASES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      <div className="text-xs text-gray-500">
        {r.frame ? <>Frame: Trip GOOSE from 21-AB, stNum {r.frame.pdu.stNum}, sqNum {r.frame.pdu.sqNum}, TAL {r.frame.pdu.timeAllowedtoLive} ms{r.frame.pdu.allData[1].value.test ? ', quality: test' : ''}. Subscriber: 52-AB, in normal mode.</> : 'No frame arrives.'}
      </div>
      <ol className="flex flex-col gap-1">
        {r.steps.map(s => {
          const st = RESULT[s.result]
          return (
            <li key={s.id} className={`rounded-lg border px-3 py-1.5 text-sm ${s.result === 'fail' ? 'border-red-200 bg-red-50' : s.result === 'skip' ? 'border-gray-100 bg-gray-50' : 'border-green-200 bg-white'}`}>
              <div className="flex items-baseline gap-2">
                <span className={`font-bold ${st.cls}`}>{st.icon}</span>
                <span className={`font-semibold ${s.result === 'skip' ? 'text-gray-400' : 'text-gray-800'}`}>{s.label}</span>
                <span className="text-xs text-gray-400">{s.sub}</span>
              </div>
              <div className={`text-xs pl-5 ${s.result === 'skip' ? 'text-gray-400' : 'text-gray-600'} break-all`}>{s.detail}</div>
            </li>
          )
        })}
      </ol>
      <div className={`rounded-lg border px-3 py-2 text-sm ${OUT[r.outcome.level]}`}>{r.outcome.text}</div>
    </div>
  )
}

// ── B6: who uses test data ──
export function TestMatrixFigure() {
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-xs text-gray-500">
            <th className="text-left font-semibold p-2"></th>
            <th className="font-semibold p-2">Subscriber in normal mode (on)</th>
            <th className="font-semibold p-2">Subscriber in test mode</th>
          </tr>
        </thead>
        <tbody>
          {TEST_MATRIX.map(row => (
            <tr key={String(row.dataTest)} className="border-t border-gray-100">
              <th className="text-left text-xs font-semibold text-gray-600 p-2">{row.dataTest ? 'Publisher in test: data flagged test' : 'Publisher in normal mode'}</th>
              {row.cells.map(c => (
                <td key={c.mode} className="p-2 text-center">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${c.use ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{c.use ? 'uses it' : 'treats as invalid'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400">The lower-left cell is the digital open test switch: a relay under test can trip all it likes, and the in-service breaker IED ignores it.</p>
    </div>
  )
}
