import { useEffect, useRef } from 'react'
import { fmtTime } from '../lib/units'

const KIND_STYLE = {
  fault: 'text-red-700 font-semibold',
  trip: 'text-red-700 font-semibold',
  publish: 'text-gray-600',
  accept: 'text-gray-800',
  coil: 'text-red-700 font-semibold',
  pos: 'text-gray-700',
  open: 'text-green-700 font-semibold',
  seen: 'text-gray-700',
  reset: 'text-blue-700',
  link: 'text-red-700 font-bold',
  stale: 'text-red-700 font-bold',
  mismatch: 'text-orange-700 font-bold',
  alarm: 'text-red-700 font-bold',
  subOk: 'text-green-700',
  start: 'text-gray-500',
  testIgnored: 'text-purple-700 font-semibold',
  blocked: 'text-purple-700 font-semibold',
  stuck: 'text-red-700 font-bold',
  bf: 'text-orange-700 font-bold',
  rstp: 'text-amber-700 font-semibold',
  prpLan: 'text-orange-700 font-bold',
  testset: 'text-purple-700 font-semibold',
  simLock: 'text-purple-700 font-semibold',
}

export default function EventLog({ events, eventIdx, onSelect, window: win }) {
  const activeRef = useRef(null)
  // Scroll the log box only; scrollIntoView would also scroll the page
  useEffect(() => {
    const el = activeRef.current
    const box = el?.closest('[data-scroll-box]')
    if (!box) return
    const top = el.offsetTop, bottom = top + el.offsetHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
  }, [eventIdx])

  return (
    <ol className="text-xs">
      {events.map((e, i) => {
        const past = i <= eventIdx
        const current = past && events[i].t === events[eventIdx].t
        const outside = win && (e.t < win.t0 - 1e-9 || e.t > win.t1 + 1e-9)
        return (
          <li key={i} ref={i === eventIdx ? activeRef : null}
            onClick={() => !outside && onSelect(e.t)}
            className={`flex gap-2 px-4 py-1.5 border-b border-gray-50 transition ${outside ? 'cursor-default' : 'cursor-pointer'}
              ${current ? 'bg-yellow-50' : 'hover:bg-gray-50'} ${past ? '' : 'opacity-35'}`}>
            <span className="font-mono text-gray-400 w-20 shrink-0 text-right">{fmtTime(e.t)}</span>
            <span className={KIND_STYLE[e.kind] ?? ''}>{e.text}</span>
          </li>
        )
      })}
    </ol>
  )
}
