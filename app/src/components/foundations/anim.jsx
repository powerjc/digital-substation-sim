import { useEffect, useState } from 'react'

// Seconds since `key` last changed (or since start), while `running`
export function useClock(key, running = true, maxS = Infinity) {
  const [t, setT] = useState(0)
  useEffect(() => {
    setT(0)
    if (!running) return
    let raf, t0 = performance.now()
    const tick = now => {
      const s = (now - t0) / 1000
      setT(Math.min(s, maxS))
      if (s < maxS) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [key, running, maxS])
  return t
}

export const lerp = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p })

export function Seg({ options, value, onChange }) {
  return (
    <div className="inline-flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 text-sm font-semibold rounded-md transition ${value === o.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
