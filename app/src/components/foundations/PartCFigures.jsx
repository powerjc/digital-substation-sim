import { useMemo, useState } from 'react'
import { fanout, readAux, lockoutStep, MATRIX_IEDS, SIGNAL_MATRIX, virtualInputs, AUX_CONTACTS } from '../../lib/figures'
import { defaultConfig } from '../../lib/schema'
import { fmtAppid, DBPOS_BITS } from '../../lib/goose'
import { deviceColor } from '../../lib/colors'
import { Seg } from './anim.jsx'

// ── C1: each piece of the copper trip circuit and its digital counterpart ──
export function ContactMapFigure() {
  const cfg = useMemo(defaultConfig, [])
  const g = cfg.gocbs.find(x => x.id === 'AB.Trip')
  const PAIRS = [
    { cu: 'Relay output contact (e.g. OUT101)', dg: `Dataset entry 1: ${g.entries[0].ref.split('/').pop()} = true` },
    { cu: 'Wire number and terminal (e.g. TB1-5)', dg: `Message identity: ${g.gocbRef}, APPID ${fmtAppid(g.appid)}, ${g.mac}; position 1 in ${g.datSet.split('$').pop()}` },
    { cu: 'Multi-core cable, control house to breaker', dg: `Network path: 21-AB → L1 → process bus PB → L2 → 52-AB, VLAN ${g.vlan.id}` },
    { cu: 'Trip-coil input: 52a in series with the 52 trip coil', dg: 'Breaker IED subscription → its own output contact → 52a → 52 trip coil (still copper)' },
    { cu: 'Trip-circuit supervision', dg: 'Subscription supervision (TAL, B5), plus the breaker IED supervising its own trip circuit' },
  ]
  const [sel, setSel] = useState(0)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
        <span>Hard-wired</span><span>Digital</span>
      </div>
      {PAIRS.map((p, i) => (
        <button key={i} onClick={() => setSel(i)} className={`grid grid-cols-2 gap-2 text-left rounded-lg border p-2 text-sm ${sel === i ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-400'}`}>
          <span className="text-gray-800">{p.cu}</span>
          <span className={`text-gray-800 ${i < 3 ? 'font-mono text-xs break-all' : ''}`}>{p.dg}</span>
        </button>
      ))}
      <div className="mt-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">The signal-list row that replaces the contact</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-gray-200">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="text-left p-1.5">Signal</th><th className="text-left p-1.5">Publisher</th><th className="text-left p-1.5">Dataset / entry</th><th className="text-left p-1.5">Subscribers</th></tr></thead>
            <tbody><tr>
              <td className="p-1.5">Line A–B trip</td>
              <td className="p-1.5 font-mono">21-AB ({cfg.ieds[0].name})</td>
              <td className="p-1.5 font-mono">{g.datSet.split('$').pop()} / 1</td>
              <td className="p-1.5 font-mono">52-AB</td>
            </tr></tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-gray-400">Terminal and output names are illustrative; the digital values are the simulator’s own.</p>
    </div>
  )
}

// ── C2: aux relay vs subscriptions ──
const FAILS = {
  none: { label: 'Nothing fails', copper: '', digital: '' },
  common: { label: 'The common part fails', copper: 'aux relay coil fails', digital: 'publisher stops' },
  one: { label: 'One path fails', copper: 'wire to destination 3 breaks', digital: 'link to destination 3 fails' },
}
function DestList({ title, sub, res }) {
  return (
    <div className="rounded-lg border border-gray-200 p-2 flex flex-col gap-1">
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      <div className="text-xs text-gray-500 mb-1">{sub}</div>
      {res.dests.map(d => (
        <div key={d.id} className="flex items-baseline gap-2 text-sm">
          <span className={d.delivered ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>{d.delivered ? '✓' : '✗'}</span>
          <span className="flex-1 text-gray-800">{d.name}</span>
          {!d.delivered && <span className={`text-xs font-semibold ${d.alarmed ? 'text-orange-700' : 'text-red-700'}`}>{d.alarmed ? 'alarm' : 'no alarm'}</span>}
        </div>
      ))}
      {res.extra && <div className="text-xs text-gray-600 mt-1 border-t border-gray-100 pt-1">{res.extra}</div>}
    </div>
  )
}
export function FanoutFigure() {
  const [n, setN] = useState(4)
  const [fail, setFail] = useState('none')
  const cu = fanout({ model: 'copper', n, fail })
  const dg = fanout({ model: 'digital', n, fail })
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Seg options={[{ id: 4, label: '4 destinations' }, { id: 5, label: 'Add a 5th' }]} value={n} onChange={setN} />
        <select value={fail} onChange={e => setFail(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 bg-white text-sm" aria-label="Failure">
          {Object.entries(FAILS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <DestList title="Hard-wired: 94 aux relay" sub={`${AUX_CONTACTS} contacts${fail !== 'none' ? `; ${FAILS[fail].copper}` : ''}`} res={cu} />
        <DestList title="Digital: one GOOSE" sub={`${n} subscriptions${fail !== 'none' ? `; ${FAILS[fail].digital}` : ''}`} res={dg} />
      </div>
      <p className="text-xs text-gray-400">Copper: only the trip-coil circuits are supervised (trip-circuit supervision), and a dead aux relay coil is not seen by it. Contact count illustrative.</p>
    </div>
  )
}

// ── C3: 52a / 52b into a double point ──
function Contact({ x, y, closed, label, broken }) {
  return (
    <g>
      <line x1={x - 5} y1={y - 9} x2={x - 5} y2={y + 9} stroke="#374151" strokeWidth={2} />
      <line x1={x + 5} y1={y - 9} x2={x + 5} y2={y + 9} stroke="#374151" strokeWidth={2} />
      {closed && <line x1={x - 5} y1={y} x2={x + 5} y2={y} stroke="#374151" strokeWidth={2.5} />}
      <text x={x} y={y - 13} textAnchor="middle" fontSize={10} fontWeight="700" fill="#374151">{label}</text>
      <text x={x} y={y + 22} textAnchor="middle" fontSize={8.5} fill="#6b7280">{closed ? 'closed' : 'open'}</text>
      {broken && <g stroke="#dc2626" strokeWidth={2.5}><line x1={x + 38} y1={y - 7} x2={x + 52} y2={y + 7} /><line x1={x + 38} y1={y + 7} x2={x + 52} y2={y - 7} /></g>}
    </g>
  )
}
const POS_TEXT = { on: 'on: breaker closed', off: 'off: breaker open', intermediate: 'intermediate: moving (or a wiring fault if it lasts)', bad: 'bad: both contacts closed, a contact or wiring fault' }
export function DryContactsFigure() {
  const [bkr, setBkr] = useState('closed')
  const [broken, setBroken] = useState(false)
  const r = readAux(bkr, { b52WireBroken: broken })
  const truth = readAux(bkr)
  const misleading = r.pos !== truth.pos
  const ok = r.pos === 'on' || r.pos === 'off'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Seg options={[{ id: 'closed', label: 'Breaker closed' }, { id: 'moving', label: 'Moving' }, { id: 'open', label: 'Open' }]} value={bkr} onChange={setBkr} />
        <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={broken} onChange={e => setBroken(e.target.checked)} />52b wire broken</label>
      </div>
      <svg viewBox="0 0 400 150" className="w-full h-auto max-w-xl" role="img" aria-label="52a and 52b wired to breaker IED binary inputs">
        <line x1={20} y1={20} x2={20} y2={130} stroke="#374151" strokeWidth={2.5} />
        <text x={14} y={14} fontSize={9} fill="#6b7280">(+) wetting supply</text>
        {[{ y: 50, label: '52a', closed: AUX_STATE_LOCAL(bkr).a, bi: 'BI1' }, { y: 105, label: '52b', closed: AUX_STATE_LOCAL(bkr).b, bi: 'BI2', broken }].map(c => (
          <g key={c.label}>
            <line x1={20} y1={c.y} x2={115} y2={c.y} stroke="#374151" strokeWidth={1.5} />
            <line x1={125} y1={c.y} x2={240} y2={c.y} stroke={c.broken ? '#dc2626' : '#374151'} strokeWidth={1.5} strokeDasharray={c.broken ? '4 3' : undefined} />
            <Contact x={120} y={c.y} closed={c.closed} label={c.label} broken={c.broken} />
            <text x={248} y={c.y + 4} fontSize={10} fill="#ea580c" fontWeight="700">{c.bi}</text>
            <text x={276} y={c.y + 4} fontSize={9.5} fill="#374151">reads {c.label === '52a' ? (r.a ? 'closed' : 'open') : (r.b ? 'closed' : 'open')}</text>
          </g>
        ))}
        <rect x={240} y={20} width={150} height={110} rx={6} fill="none" stroke="#ea580c" strokeWidth={1.5} />
        <text x={315} y={34} textAnchor="middle" fontSize={11} fontWeight="700" fill="#ea580c">Breaker IED</text>
        <text x={60} y={145} fontSize={8.5} fill="#9ca3af">at the breaker: short local copper</text>
      </svg>
      <div className={`rounded-lg border px-3 py-2 text-sm ${ok ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
        <span className="font-mono font-semibold">XCBR1.Pos.stVal = {DBPOS_BITS[r.pos]}</span> ({POS_TEXT[r.pos]})
        {misleading && <div className="text-red-800 mt-1">The breaker is really {bkr}. Because the IED reads both contacts, the broken wire shows up as a lasting intermediate state and an alarm, not as a wrong position.</div>}
      </div>
    </div>
  )
}
// what the contacts physically are (independent of wiring)
const AUX_STATE_LOCAL = b => readAux(b)

// ── C4: lockout ──
export function LockoutFigure() {
  const [retained, setRetained] = useState(true)
  const init = { lo: false, closed: true, note: 'In service.' }
  const [cu, setCu] = useState(init)
  const [dg, setDg] = useState(init)
  const act = a => {
    setCu(s => lockoutStep(s, a, { model: 'copper' }))
    setDg(s => lockoutStep(s, a, { model: 'digital', retained }))
  }
  const Col = ({ title, s }) => (
    <div className="rounded-lg border border-gray-200 p-2 flex flex-col gap-1">
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      <div className="flex gap-2 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-bold ${s.lo ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'}`}>{s.lo ? 'LOCKOUT SET' : 'reset'}</span>
        <span className={`rounded px-1.5 py-0.5 font-bold ${s.closed ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>52 {s.closed ? 'CLOSED' : 'OPEN'}</span>
      </div>
      <div className="text-sm text-gray-700">{s.note}</div>
    </div>
  )
  const B = ({ a, children }) => <button onClick={() => act(a)} className="px-3 py-1 rounded-lg text-sm font-semibold border border-gray-300 bg-white text-gray-700 hover:border-gray-500">{children}</button>
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <B a="trip">Trip</B><B a="close">Try to close</B><B a="restart">Power interruption / IED restart</B><B a="reset">Reset</B>
        <button onClick={() => { setCu(init); setDg(init) }} className="px-3 py-1 rounded-lg text-sm text-gray-500">Start over</button>
      </div>
      <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={retained} onChange={e => setRetained(e.target.checked)} />Digital latch stored in non-volatile memory</label>
      <div className="grid sm:grid-cols-2 gap-2">
        <Col title="86 lockout relay" s={cu} />
        <Col title="Lockout in IED logic" s={dg} />
      </div>
      <p className="text-xs text-gray-400">Try: Trip, then restart with the latch not stored, then Try to close.</p>
    </div>
  )
}

// ── C5: signal matrix ──
export function MatrixFigure() {
  const [cell, setCell] = useState({ row: 'AB.Trip', ied: '52-AB' })
  const [ied, setIed] = useState(null)
  const r = SIGNAL_MATRIX.find(x => x.id === cell.row)
  const inSim = id => ['AB.Trip', 'AB.Pos'].includes(id)
  const vis = ied ? virtualInputs(ied) : []
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse min-w-[30rem] w-full">
          <thead>
            <tr>
              <th className="text-left p-1.5 text-gray-500 font-semibold sticky left-0 bg-white z-10">Signal (publisher)</th>
              {MATRIX_IEDS.map(d => (
                <th key={d} className="p-1">
                  <button onClick={() => setIed(x => (x === d ? null : d))} className={`px-1.5 py-0.5 rounded font-bold ${ied === d ? 'bg-indigo-100' : 'hover:bg-gray-100'}`} style={{ color: deviceColor(d) }}>{d}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIGNAL_MATRIX.map(row => (
              <tr key={row.id} className="border-t border-gray-100">
                <td className="p-1.5 text-gray-800 whitespace-nowrap sticky left-0 bg-white z-10 max-w-[11rem] sm:max-w-none overflow-hidden text-ellipsis">{row.signal} <span className="text-gray-400">({row.pub})</span>{inSim(row.id) && <span className="ml-1 text-[10px] rounded bg-indigo-50 text-indigo-700 px-1">in the bay simulator</span>}</td>
                {MATRIX_IEDS.map(d => {
                  const sub = row.subs[d], pub = row.pub === d
                  const on = cell.row === row.id && cell.ied === d
                  return (
                    <td key={d} className="p-0.5 text-center">
                      <button onClick={() => setCell({ row: row.id, ied: d })}
                        className={`w-full rounded py-1 ${on ? 'ring-2 ring-indigo-400' : ''} ${sub ? 'bg-green-100 text-green-800 font-bold' : pub ? 'bg-blue-50 text-blue-700' : 'text-gray-300'}`}>
                        {sub ? '●' : pub ? 'pub' : '·'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <span className="font-semibold">{r.signal}</span>, published by {r.pub}:{' '}
        {r.pub === cell.ied ? 'this is the publisher.' : r.subs[cell.ied] ? <>{cell.ied} subscribes. {r.subs[cell.ied]}</> : <>{cell.ied} does not subscribe.</>}
      </div>
      {ied && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-sm">
          <div className="font-semibold mb-1">Virtual inputs of {ied}</div>
          {vis.length ? (
            <ul className="space-y-0.5">{vis.map(v => <li key={v.vi}><span className="font-mono font-semibold">{v.vi}</span> ← {v.signal} ({v.from}): {v.use}</li>)}</ul>
          ) : <span className="text-gray-600">None: {ied} only publishes in this matrix.</span>}
        </div>
      )}
      <p className="text-xs text-gray-400">Illustrative design for the end-goal station; a real project has many more signals (reclose, interlocking, alarms).</p>
    </div>
  )
}
