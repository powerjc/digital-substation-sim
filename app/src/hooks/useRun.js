import { useState, useMemo, useEffect, useRef } from 'react'
import { simulate, stateAt, EPS } from '../lib/timeline'
import { EMPTY_SCENARIO, normalizeScenario } from '../lib/scenario'

// Two fixed views instead of a free zoom: the burst after a change is
// milliseconds, the heartbeat is seconds.
export const ZOOMS = {
  trip: { id: 'trip', label: 'Around the trip', t0: -0.005, t1: 0.085, speeds: [0.002, 0.005, 0.02], speed: 0.005 },
  heartbeats: { id: 'heartbeats', label: 'Heartbeats', t0: -3.0, t1: 2.5, speeds: [0.1, 0.25, 1], speed: 0.25 },
}

export function useRun(config) {
  const [scenario, setScenarioRaw] = useState(EMPTY_SCENARIO)
  const [zoomId, setZoomId] = useState('trip')
  const [time, setTimeRaw] = useState(-Infinity)
  const [playing, setPlaying] = useState(false)
  const [speeds, setSpeeds] = useState({ trip: ZOOMS.trip.speed, heartbeats: ZOOMS.heartbeats.speed })

  const zoom = ZOOMS[zoomId]
  const sim = useMemo(() => simulate(config, scenario), [config, scenario])
  const t = Math.max(zoom.t0, Math.min(time, zoom.t1))
  const { idx, state } = stateAt(sim.events, t)
  const speed = speeds[zoomId]

  function rewind() { setTimeRaw(-Infinity); setPlaying(false) }
  function setScenario(fn) { setScenarioRaw(prev => normalizeScenario(typeof fn === 'function' ? fn(prev) : fn)); rewind() }
  function setZoom(id) { setZoomId(id); setPlaying(false) }
  function setTime(v) { setPlaying(false); setTimeRaw(v) }

  const inWin = x => x >= zoom.t0 - EPS && x <= zoom.t1 + EPS
  const eventTimes = [...new Set(sim.events.map(e => e.t).filter(inWin))]
  const frameTimes = [...new Set(sim.frames.map(f => f.sendT).filter(inWin))]
  const next = list => list.find(x => x > t + EPS)
  const prev = list => [...list].reverse().find(x => x < t - EPS)

  function stepForward() { setTime(next(eventTimes) ?? zoom.t1) }
  function stepBack() { setTime(prev(eventTimes) ?? zoom.t0) }
  function frameForward() { setTime(next(frameTimes) ?? zoom.t1) }
  function frameBack() { setTime(prev(frameTimes) ?? zoom.t0) }

  function togglePlay() {
    if (!playing && t >= zoom.t1 - EPS) setTimeRaw(zoom.t0)
    else setTimeRaw(t)
    setPlaying(p => !p)
  }

  // Playback clock
  const endRef = useRef(zoom.t1)
  endRef.current = zoom.t1
  useEffect(() => {
    if (!playing) return
    let raf, last = performance.now()
    const tick = now => {
      const dt = (now - last) / 1000
      last = now
      setTimeRaw(p => {
        const n = p + dt * speed
        if (n >= endRef.current) { setPlaying(false); return endRef.current }
        return n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])

  return {
    sim, state, eventIdx: idx, time: t, setTime,
    zoom, setZoom, playing, togglePlay, speed, setSpeed: s => setSpeeds(p => ({ ...p, [zoomId]: s })),
    stepForward, stepBack, frameForward, frameBack, rewind,
    scenario, setScenario, loadScenario: sc => setScenario(normalizeScenario(sc)),
    atEnd: t >= zoom.t1 - EPS,
  }
}
