import { fmtTime, fmtDur } from '../lib/units'
import { deviceColor } from '../lib/colors'

// What the operator sees: the gateway's picture of each relay (from MMS
// reports and general interrogation) next to what is actually true, and the
// reports as they arrive. Feature mms.

const POS = { on: 'closed', off: 'open', intermediate: 'moving', bad: 'bad' }
const val = (signal, v) => (v === null || v === undefined ? '—' : signal === 'pos' ? POS[v] ?? v : v ? 'TRIP' : 'off')
const HOW = { onTime: 'on time', tcp: 'TCP retransmission', buffer: 'from the buffer', lost: 'never reported' }
const ASSOC = {
  up: { t: 'associated', c: 'text-green-700' },
  connecting: { t: 'reconnecting', c: 'text-amber-700 font-semibold' },
  lost: { t: 'LOST', c: 'text-red-700 font-bold' },
}

export default function ScadaPanel({ config, run }) {
  const { state, time, sim } = run
  const rcbs = config.rcbs ?? []
  const reports = (sim.reports ?? []).filter(r => r.tSent <= time + 1e-9)
  const shown = reports.slice(-8)
  return (
    <div className="flex flex-col gap-3 text-sm max-w-5xl">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="py-1 pr-2 font-medium">Relay</th>
              <th className="py-1 pr-2 font-medium">Association</th>
              <th className="py-1 pr-2 font-medium">Report</th>
              <th className="py-1 pr-2 font-medium">SCADA shows</th>
              <th className="py-1 font-medium">Last time stamp</th>
            </tr>
          </thead>
          <tbody>
            {rcbs.map(rcb => {
              const m = state.mms?.[rcb.ied] ?? { assoc: 'up' }
              const sc = state.scada?.[rcb.ied] ?? {}
              const st = state.ieds[rcb.ied] ?? {}
              const bkr = config.ieds.find(d => d.kind === 'breaker' && d.bay === config.ieds.find(x => x.id === rcb.ied)?.bay)
              const actual = { trip: !!st.trip, bf: !!st.bf, pos: bkr ? state.ieds[bkr.id]?.pos : st.seenPos }
              const a = ASSOC[m.assoc] ?? ASSOC.up
              return (
                <tr key={rcb.id} className="border-b border-gray-100 align-top">
                  <td className="py-1 pr-2 font-semibold" style={{ color: deviceColor(rcb.ied) }}>{rcb.ied}</td>
                  <td className={`py-1 pr-2 ${a.c}`}>{a.t}{m.queued ? <span className="text-gray-500 font-normal"> · {m.queued} in TCP</span> : null}{m.buffered ? <span className="text-gray-500 font-normal"> · {m.buffered} buffered</span> : null}</td>
                  <td className="py-1 pr-2 text-gray-600">{m.unbuffered ? <span className="text-red-700 font-semibold">unbuffered</span> : 'buffered'}</td>
                  <td className="py-1 pr-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {rcb.items.map(it => {
                        const shows = sc[it.signal], real = actual[it.signal]
                        const differs = sc.stale || (shows !== null && shows !== undefined && real !== undefined && shows !== real && !(it.signal === 'pos' && real === null))
                        return (
                          <span key={it.signal} className={differs ? 'text-red-700' : 'text-gray-800'}>
                            {it.label} <b>{val(it.signal, shows)}</b>
                            {differs && real !== undefined && real !== null && shows !== real ? <span className="text-gray-500"> (really {val(it.signal, real)})</span> : null}
                          </span>
                        )
                      })}
                      {sc.stale && <span className="text-red-700 font-semibold">not current</span>}
                    </div>
                  </td>
                  <td className="py-1 text-gray-600 whitespace-nowrap">{sc.t !== null && sc.t !== undefined && sc.t >= sim.startT ? fmtTime(sc.t) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-1">Reports{reports.length > shown.length ? ` (last ${shown.length} of ${reports.length})` : ''}</div>
        {!shown.length && <div className="text-xs text-gray-400">No report since the start of the run: nothing has changed yet.</div>}
        {shown.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-0.5 pr-2 font-medium">Received</th>
                <th className="py-0.5 pr-2 font-medium">From</th>
                <th className="py-0.5 pr-2 font-medium">Data</th>
                <th className="py-0.5 pr-2 font-medium">Time stamp</th>
                <th className="py-0.5 font-medium">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const got = r.tRx !== null && r.tRx <= time + 1e-9
                return (
                  <tr key={r.no} className="border-b border-gray-50">
                    <td className={`py-0.5 pr-2 whitespace-nowrap ${got ? 'text-gray-800' : r.fate === 'lost' ? 'text-red-700 font-semibold' : 'text-gray-400'}`}>{got ? fmtTime(r.tRx) : r.fate === 'lost' ? 'never' : 'waiting'}</td>
                    <td className="py-0.5 pr-2 font-semibold" style={{ color: deviceColor(r.ied) }}>{r.ied}</td>
                    <td className="py-0.5 pr-2 font-mono">{r.ref.split('/').pop()} = {r.signal === 'pos' ? r.value : String(r.value)}</td>
                    <td className="py-0.5 pr-2 whitespace-nowrap">{fmtTime(r.tEvent)}</td>
                    <td className={`py-0.5 ${r.fate === 'onTime' ? 'text-gray-500' : r.fate === 'lost' ? 'text-red-700' : 'text-amber-700'}`}>
                      {got || r.fate === 'lost' ? HOW[r.fate] : r.fate === 'buffer' ? 'in the buffer' : 'TCP retransmitting'}
                      {got && r.fate !== 'onTime' ? ` (+${fmtDur(r.tRx - r.tEvent)})` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Each relay sends a report when a value changes; the gateway passes it on to SCADA with the relay’s own time stamp. A buffered report keeps changes while the association is down and sends them when it returns; an unbuffered one doesn’t. After reconnecting, the gateway reads every value again (general interrogation). Server and timeout figures are illustrative.
      </p>
    </div>
  )
}
