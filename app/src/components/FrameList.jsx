import { useEffect, useRef } from 'react'
import { deviceColor, FATE } from '../lib/colors'
import { fmtTime } from '../lib/units'
import { fmtAppid } from '../lib/goose'

export function FateBadge({ rx }) {
  const f = FATE[rx?.fate] ?? FATE.inFlight
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${f.bg}`}>{f.label}</span>
}

export default function FrameList({ config, run, selectedFrame, onSelect, detail }) {
  const { sim, time, zoom } = run
  const frames = sim.frames.filter(f => f.sendT >= zoom.t0 - 1e-9 && f.sendT <= zoom.t1 + 1e-9)
  const gocb = id => config.gocbs.find(g => g.id === id)
  const lastSent = [...frames].reverse().find(f => f.sendT <= time + 1e-9)
  const activeRef = useRef(null)
  useEffect(() => {
    const el = activeRef.current
    const box = el?.closest('[data-scroll-box]')
    if (!box) return
    const top = el.offsetTop, bottom = top + el.offsetHeight
    if (top < box.scrollTop + 24) box.scrollTop = Math.max(0, top - 24)
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
  }, [lastSent?.id])

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-white text-gray-500 text-left">
        <tr className="border-b border-gray-200">
          <th className="px-2 py-1.5 font-semibold text-right">No.</th>
          <th className="px-2 py-1.5 font-semibold text-right">Time</th>
          <th className="px-2 py-1.5 font-semibold">Message</th>
          {detail && <th className="px-2 py-1.5 font-semibold hidden sm:table-cell">APPID</th>}
          <th className="px-2 py-1.5 font-semibold text-right">st/sq</th>
          <th className="px-2 py-1.5 font-semibold text-right">TAL</th>
          {detail && <th className="px-2 py-1.5 font-semibold text-right hidden sm:table-cell">Len</th>}
          <th className="px-2 py-1.5 font-semibold">At subscriber</th>
        </tr>
      </thead>
      <tbody>
        {frames.map(f => {
          const g = gocb(f.gocb)
          const future = f.sendT > time + 1e-9
          const sel = f.id === selectedFrame
          const rxs = Object.entries(f.rx).map(([subId, rx]) => ({ rx, ied: config.subscriptions.find(s => s.id === subId)?.ied }))
          return (
            <tr key={f.id} ref={f.id === lastSent?.id ? activeRef : null} onClick={() => onSelect(f.id)}
              className={`border-b border-gray-50 cursor-pointer ${sel ? 'bg-indigo-50' : f.id === lastSent?.id ? 'bg-yellow-50' : 'hover:bg-gray-50'} ${future ? 'opacity-35' : ''}`}>
              <td className="px-2 py-1 text-right font-mono text-gray-400">{f.no}</td>
              <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{fmtTime(f.sendT)}</td>
              <td className="px-2 py-1 whitespace-nowrap"><span className="font-semibold" style={{ color: deviceColor(f.pub) }}>{g.label}</span> <span className="text-gray-400 hidden sm:inline">{f.pub}</span></td>
              {detail && <td className="px-2 py-1 font-mono hidden sm:table-cell">{fmtAppid(f.appid)}</td>}
              <td className={`px-2 py-1 text-right font-mono ${f.pdu.sqNum === 0 ? 'font-bold' : ''}`}>{f.pdu.stNum}/{f.pdu.sqNum}</td>
              <td className="px-2 py-1 text-right font-mono">{f.pdu.timeAllowedtoLive}</td>
              {detail && <td className="px-2 py-1 text-right font-mono hidden sm:table-cell">{f.length}</td>}
              <td className="px-2 py-1 whitespace-nowrap">{!future && rxs.map((x, i) => (
                <span key={i} className="mr-1"><span className="text-gray-400 hidden sm:inline">{x.ied} </span><FateBadge rx={x.rx} /></span>
              ))}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
