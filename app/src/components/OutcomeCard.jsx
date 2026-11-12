import { fmtProt, fmtDur } from '../lib/units'

const VERDICT = {
  delivered:    { label: 'Trip delivered',              style: 'bg-green-100 text-green-800 border-green-300' },
  late:         { label: 'Trip delivered late',         style: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  notDelivered: { label: 'Trip NOT delivered',          style: 'bg-red-100 text-red-800 border-red-300' },
}
const NOTE_STYLE = { info: 'text-gray-600', warn: 'text-yellow-700', bad: 'text-red-700 font-medium' }

function Budget({ outcome }) {
  const b = outcome.budget
  if (!b) return null
  const parts = [
    { key: 'pub', label: 'publish', s: b.publishS, color: '#2563eb' },
    { key: 'wait', label: 'wait for repeat', s: b.waitS, color: '#d97706' },
    { key: 'net', label: 'network', s: b.networkS, color: '#475569' },
    { key: 'sub', label: 'subscribe', s: b.subscribeS, color: '#ea580c' },
  ].filter(p => p.s > 1e-9)
  const total = parts.reduce((s, p) => s + p.s, 0)
  const scale = Math.max(total, (outcome.classMs / 1000) * 1.15)
  const pct = s => `${(s / scale) * 100}%`
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1">
        <span>Transfer time: relay logic → breaker IED logic</span>
        <span className="font-mono">{fmtDur(total)}</span>
      </div>
      <div className="relative h-5 rounded bg-gray-100">
        <div className="absolute inset-0 flex">
          {parts.map(p => <div key={p.key} style={{ width: pct(p.s), background: p.color, minWidth: p.key === 'net' ? 2 : 0 }} className="h-5 first:rounded-l opacity-80" title={`${p.label}: ${fmtDur(p.s)}`} />)}
        </div>
        <div className="absolute -top-1 -bottom-1 border-l-2 border-dashed border-gray-700" style={{ left: pct(outcome.classMs / 1000) }} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500">
        {parts.map(p => (
          <span key={p.key}><span style={{ color: p.color }}>■</span> {p.label} {fmtDur(p.s)}</span>
        ))}
        <span>┆ {outcome.classMs} ms class ({outcome.className})</span>
      </div>
      <p className="text-[11px] text-gray-400 mt-1">Stack and network times are illustrative.</p>
    </div>
  )
}

export default function OutcomeCard({ outcome, revealed, onReveal }) {
  const v = VERDICT[outcome.verdict]
  const f = outcome.freqHz
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        {revealed ? (
          <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${v.style}`}>{v.label}</span>
        ) : (
          <button onClick={onReveal} className="inline-block rounded border px-2 py-0.5 text-xs font-bold bg-gray-50 text-gray-400 border-gray-200 hover:text-gray-600">
            Outcome: play to the end, or tap to show
          </button>
        )}
      </div>
      {revealed && (
        <>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {outcome.tripT !== null && <><dt className="text-gray-500">Relay trip</dt><dd className="font-mono">{fmtProt(outcome.tripT, f)}</dd></>}
            <dt className="text-gray-500">Trip coil</dt><dd className="font-mono">{outcome.coilT !== null ? fmtProt(outcome.coilT, f) : 'never'}</dd>
            <dt className="text-gray-500">Breaker open</dt><dd className="font-mono">{outcome.openT !== null ? fmtProt(outcome.openT, f) : 'never'}</dd>
          </dl>
          <Budget outcome={outcome} />
          {outcome.notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {outcome.notes.map((n, i) => <li key={i} className={`text-xs ${NOTE_STYLE[n.level]}`}>• {n.text}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
