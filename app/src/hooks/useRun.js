import { useState, useMemo, useEffect, useRef } from 'react'
import { simulate, stateAt, EPS } from '../lib/timeline'
import { EMPTY_SCENARIO, normalizeScenario } from '../lib/scenario'
import { isActive } from '../lib/features'

// Fixed views instead of a free zoom: the burst after a change is
// milliseconds, the heartbeat is seconds.
export const ZOOMS = {
  trip: { id: 'trip', label: 'Around the trip', t0: -0.005, t1: 0.085, speeds: [0.002, 0.005, 0.02], speed: 0.005 },
  bf: { id: 'bf', label: 'Up to 250 ms', t0: -0.01, t1: 0.25, speeds: [0.005, 0.01, 0.05], speed: 0.01, feature: ['secondBay', 'redundancy', 'transformerBay'] },
  control: { id: 'control', label: 'Operator command', t0: 0.49, t1: 0.82, speeds: [0.02, 0.05, 0.2], speed: 0.05, feature: 'controls' },
  heartbeats: { id: 'heartbeats', label: 'Heartbeats', t0: -3.0, t1: 2.5, speeds: [0.1, 0.25, 1], speed: 0.25 },
}

// The views this config offers (the breaker-failure view needs the second bay)
export const zoomsFor = config => Object.values(ZOOMS).filter(z => !z.feature || [z.feature].flat().some(f => isActive(config, f)))

// config: the station config (stationConfig(config)), which the engine runs
export function useRun(config) {
  const [scenario, setScenarioRaw] = useState(EMPTY_SCENARIO)
  const [zoomId, setZoomId] = useState('trip')
  const [time, setTimeRaw] = useState(-Infinity)
  const [playing, setPlaying] = useState(false)
  const [speeds, setSpeeds] = useState(Object.fromEntries(Object.values(ZOOMS).map(z => [z.id, z.speed])))

  const zooms = zoomsFor(config)
  const zoom = zooms.find(z => z.id === zoomId) ?? ZOOMS.trip
  const sim = useMemo(() => simulate(config, scenario), [config, scenario])
  const t = Math.max(zoom.t0, Math.min(time, zoom.t1))
  const { idx, state } = stateAt(sim.events, t)
  const speed = speeds[zoom.id]

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
    zoom, zooms, setZoom, playing, togglePlay, speed, setSpeed: s => setSpeeds(p => ({ ...p, [zoom.id]: s })),
    stepForward, stepBack, frameForward, frameBack, rewind,
    scenario, setScenario, loadScenario: sc => setScenario(normalizeScenario(sc)),
    atEnd: t >= zoom.t1 - EPS,
  }
}
