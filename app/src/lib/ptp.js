// Time synchronization (PTP, IEC 61850-9-3) at the level the lessons need:
// grandmaster states, which clock is grandmaster, and each merging unit's
// smpSynch over time. Not modelled message by message.
//
// Grandmaster: locked to GPS (clock class 6) → GPS lost: holdover (7) →
// holdover past its spec: degraded (52) → or failed. The best master clock
// algorithm picks the best live clock; when the grandmaster fails, the others
// only take over after the failover time (announce receipt timeout).
// Merging unit: follows the grandmaster while a PTP path exists; smpSynch 2
// when the grandmaster is traceable to GPS (locked or in holdover), 1 when it
// runs on local time (degraded); after losing the grandmaster it keeps its
// last value for its own holdover time, then 0.

export const GM_CLASS = { locked: 6, holdover: 7, degraded: 52, free: 248 }
const RANK = ['locked', 'holdover', 'degraded', 'free']

export function gmState(gm, t, ptpCfg, sc = {}) {
  if (Number.isFinite(sc.failAt) && t >= sc.failAt) return 'failed'
  if (sc.gpsLostAt !== null && sc.gpsLostAt !== undefined && t >= sc.gpsLostAt) {
    return t - sc.gpsLostAt < ptpCfg.gmHoldoverS ? 'holdover' : 'degraded'
  }
  return 'locked'
}

// gms: [{ id, priority2 }]; scGm: { [id]: { gpsLostAt, failAt } };
// reach(gmId, muId, t) → is there a PTP path at t
export function ptpModel({ gms, mus, ptpCfg, scGm = {}, reach, startT, extraCuts = [] }) {
  const st = (id, t) => gmState(id, t, ptpCfg, scGm[id])
  const better = (a, b, t) => RANK.indexOf(st(a.id, t)) - RANK.indexOf(st(b.id, t)) || a.priority2 - b.priority2
  const best = t => gms.filter(g => st(g.id, t) !== 'failed').sort((a, b) => better(a, b, t))[0]?.id ?? null

  const cuts = new Set([startT, ...extraCuts.filter(Number.isFinite)])
  for (const g of gms) {
    const s = scGm[g.id] ?? {}
    if (Number.isFinite(s.gpsLostAt)) { cuts.add(s.gpsLostAt); cuts.add(s.gpsLostAt + ptpCfg.gmHoldoverS) }
    if (Number.isFinite(s.failAt)) { cuts.add(s.failAt); cuts.add(s.failAt + ptpCfg.failoverS) }
  }
  const queue = [...cuts].filter(t => t >= startT).sort((a, b) => a - b)
  const events = []
  const gmSegs = [] // { t0, active }
  const muSegs = Object.fromEntries(mus.map(m => [m, []]))
  const mu = Object.fromEntries(mus.map(m => [m, { synch: null, lostAt: null }]))
  let active = null, lostAt = null
  const prevState = {}
  const seen = new Set()
  while (queue.length) {
    queue.sort((a, b) => a - b)
    const t = queue.shift()
    if (seen.has(t)) continue
    seen.add(t)
    const te = t + 1e-9
    for (const g of gms) {
      const s = st(g.id, te)
      if (prevState[g.id] !== undefined && s !== prevState[g.id]) {
        const text = { holdover: `${g.id} loses GPS: holdover on its own oscillator (clock class 7)`,
          degraded: `${g.id} has been in holdover past its spec: local time only (clock class 52)`,
          failed: `${g.id} fails`, locked: `${g.id} locked to GPS again` }[s]
        events.push({ t, kind: 'ptp', dev: g.id, text })
      }
      prevState[g.id] = s
    }
    // Which clock is grandmaster
    if (active && st(active, te) === 'failed') { lostAt = t; active = null; events.push({ t, kind: 'ptp', text: 'No grandmaster: every clock holds its own time until another takes over' }) }
    const cand = best(te)
    if (!active) {
      if (cand && (lostAt === null || t >= lostAt + ptpCfg.failoverS - 1e-9)) {
        if (lostAt !== null || t > startT) events.push({ t, kind: 'ptp', dev: cand, text: `Best master clock: ${cand} is grandmaster${lostAt !== null ? `, ${ptpCfg.failoverS} s after the last one failed` : ''}` })
        active = cand
        lostAt = null
      } else if (lostAt === null && !cand) lostAt = t
    } else if (cand && cand !== active && RANK.indexOf(st(cand, te)) < RANK.indexOf(st(active, te))) {
      events.push({ t, kind: 'ptp', dev: cand, text: `Best master clock: ${cand} has the better clock and becomes grandmaster` })
      active = cand
    }
    gmSegs.push({ t0: t, active, states: Object.fromEntries(gms.map(g => [g.id, st(g.id, te)])) })
    // Each merging unit
    for (const m of mus) {
      const u = mu[m]
      let synch
      if (active && reach(active, m, te)) {
        synch = st(active, te) === 'degraded' ? 1 : 2
        u.lostAt = null
      } else {
        if (u.lostAt === null) { u.lostAt = t; queue.push(t + ptpCfg.muHoldoverS) }
        synch = t < u.lostAt + ptpCfg.muHoldoverS - 1e-9 ? (u.synch ?? 0) : 0
      }
      if (synch !== u.synch) muSegs[m].push({ t0: t, synch })
      u.synch = synch
    }
  }
  const at = (segs, t) => { let v = segs[0]; for (const s of segs) if (s.t0 <= t + 1e-12) v = s; return v }
  return {
    cuts: [...seen].sort((a, b) => a - b),
    events,
    synchAt: (m, t) => at(muSegs[m], t)?.synch ?? 0,
    gmAt: t => at(gmSegs, t),
  }
}

// Fixed choices for the failure panel
export const GPS_PRESETS = [
  { id: '', label: 'Locked to GPS', at: null },
  { id: 'quiet', label: 'Loses GPS 2 s before the fault', at: -2.0 },
  { id: 'long', label: 'Lost GPS long ago (past holdover)', at: -1000 },
]
export const GM_FAIL_PRESETS = [
  { id: '', label: 'In service', at: null },
  { id: 'fault', label: 'Fails 2.5 s before the fault', at: -2.5 },
  { id: 'early', label: 'Fails 5 s before the fault', at: -5.0 },
]
