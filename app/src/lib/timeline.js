// Discrete-event engine for one run: quiet period with heartbeats, a scripted
// fault and trip, GOOSE publication with retransmission, the network, each
// subscriber's checks and supervision, the breaker, and an outcome.
//
// Pure and deterministic: simulate(config, scenario) has no I/O and no
// randomness. Times are in seconds internally; the fault is at t = 0.
// Every state change is an event with a full state snapshot; every frame is
// recorded with its path and its fate at each subscriber.

import { PROFILES, TRIP_CLASS, iedById, subsOfGocb } from './schema'
import { applyScenario, normalizeScenario } from './scenario'
import { buildTopo, forward } from './network'
import { buildFrame, datasetValues, matchFrame, sequenceCheck, testHandling, fmtAppid } from './goose'
import { fmtTime, fmtDur } from './units'

export const START_T = -3.0 // run shown from here (quiet period)
export const END_T = 2.5
const WARM_T = -6.0 // simulated but not shown: publishers and subscribers settle into steady state
export const EPS = 1e-9

// Heartbeat phase of each control block: frames at phase − k·heartbeat,
// spread so the publishers don't send at the same instant.
const heartbeatPhase = i => -0.6 + 0.3 * i

class Queue {
  constructor() { this.items = []; this.seq = 0 }
  push(t, fn) { this.items.push({ t, seq: this.seq++, fn }) }
  pop() {
    let best = 0
    for (let i = 1; i < this.items.length; i++) {
      const a = this.items[i], b = this.items[best]
      if (a.t < b.t - EPS || (Math.abs(a.t - b.t) <= EPS && a.seq < b.seq)) best = i
    }
    return this.items.splice(best, 1)[0]
  }
  get size() { return this.items.length }
  peekT() { return this.items.reduce((m, x) => Math.min(m, x.t), Infinity) }
}

const DBPOS_TEXT = { on: 'closed', off: 'open', intermediate: 'intermediate (moving)', bad: 'bad state' }

export function simulate(baseConfig, scenarioIn) {
  const scenario = normalizeScenario(scenarioIn)
  const cfg = applyScenario(baseConfig, scenario)
  const topo = buildTopo(cfg)
  const prof = PROFILES[cfg.goose.profile] ?? PROFILES.typical
  const f = cfg.freqHz
  const T = cfg.timing
  const pubS = cfg.stack.publishMs / 1000
  const subS = cfg.stack.subscribeMs / 1000
  const q = new Queue()
  const events = []
  const frames = []

  // ── State ──
  const ieds = {}
  for (const d of cfg.ieds) {
    ieds[d.id] = d.kind === 'relay'
      ? { trip: false, seenPos: null }
      : { pos: 'on', coil: false, contactsClosed: true, tripIn: null }
  }
  const subs = Object.fromEntries(cfg.subscriptions.map(s => [s.id,
    { status: 'noMsg', since: WARM_T, reason: 'no valid message received since start-up', lastSt: null, lastSq: null, deadline: null }]))
  const pubs = Object.fromEntries(cfg.gocbs.map(g => [g.id,
    { stNum: 1, sqNum: 0, changeT: WARM_T, gen: 0, values: datasetValues(g, ieds[g.ied], iedById(cfg, g.ied)) }]))
  let fault = false

  const snapshot = () => structuredClone({ fault, ieds, subs, pubs: Object.fromEntries(Object.entries(pubs).map(([k, p]) => [k, { stNum: p.stNum, sqNum: p.sqNum }])) })
  const log = (t, kind, text, dev = null, extra = {}) => {
    if (t >= START_T - EPS) events.push({ t, kind, text, dev, ...extra, state: snapshot() })
  }

  // ── Publishing ──
  function send(g, t, intervalIdx) {
    const p = pubs[g.id]
    const ied = iedById(cfg, g.ied)
    const nextMs = intervalIdx < prof.intervalsMs.length ? prof.intervalsMs[intervalIdx] : prof.heartbeatMs
    const frame = buildFrame({
      id: frames.length, gocb: g, ied, sendT: t, changeT: p.changeT,
      stNum: p.stNum, sqNum: p.sqNum, tal: prof.talFactor * nextMs, allData: p.values,
    })
    p.sqNum++
    const r = forward(topo, cfg, scenario, frame, t)
    frame.hops = r.hops
    frame.rx = {}
    for (const sub of subsOfGocb(cfg, g.id)) {
      const a = r.arrivals.find(x => x.ied === sub.ied)
      if (a) {
        frame.rx[sub.id] = { fate: 'pending', t: a.t }
        q.push(a.t, () => receive(sub, frame, a.t))
      } else {
        const loss = r.losses.find(x => x.ied === sub.ied)
        frame.rx[sub.id] = { fate: 'lost', t: null, kind: loss?.kind ?? 'nopath', reason: loss ? `never arrived: ${loss.where}` : 'never arrived: no path' }
      }
    }
    frames.push(frame)
    const gen = p.gen
    q.push(t + nextMs / 1000, () => { if (pubs[g.id].gen === gen) send(g, t + nextMs / 1000, intervalIdx + 1) })
  }

  // An IED's data changed at t: each control block carrying that signal
  // publishes a new state after the publisher's stack time.
  function dataChanged(iedId, signal, t) {
    for (const g of cfg.gocbs.filter(x => x.ied === iedId && x.entries.some(e => e.signal === signal))) {
      const values = datasetValues(g, ieds[iedId], iedById(cfg, iedId))
      q.push(t + pubS, () => {
        const p = pubs[g.id]
        p.stNum++
        p.sqNum = 0
        p.gen++
        p.changeT = t
        p.values = values
        log(t + pubS, 'publish', `${iedId} publishes ${g.label} GOOSE, new state: stNum ${p.stNum}, sqNum 0`, iedId, { gocb: g.id })
        send(g, t + pubS, 0)
      })
    }
  }

  // ── Subscribing ──
  function setStatus(sub, status, t, reason = null) {
    const s = subs[sub.id]
    const was = s.status
    s.status = status
    s.since = t
    s.reason = reason
    const g = cfg.gocbs.find(x => x.id === sub.gocb)
    if (status === 'healthy' && was !== 'healthy') log(t, 'subOk', `${sub.ied}: ${g.label} subscription healthy`, sub.ied, { sub: sub.id })
    if (status === 'stale') log(t, 'stale', `${sub.ied}: ${g.label} GOOSE lost, ${reason}. Alarm`, sub.ied, { sub: sub.id })
    if (status === 'mismatch' && was !== 'mismatch') log(t, 'mismatch', `${sub.ied}: ${g.label} GOOSE ${reason}. Alarm`, sub.ied, { sub: sub.id })
  }

  function receive(sub, frame, t) {
    const ied = iedById(cfg, sub.ied)
    const s = subs[sub.id]
    const m = matchFrame(frame, sub)
    if (m.fate !== 'ok') {
      frame.rx[sub.id] = { fate: m.fate, t, reason: m.reason, compare: m.compare }
      if (m.fate === 'rejected' && s.status !== 'mismatch') setStatus(sub, 'mismatch', t, m.reason)
      return
    }
    const seq = sequenceCheck(s, frame)
    if (seq.kind === 'old') {
      frame.rx[sub.id] = { fate: 'old', t, reason: seq.note, compare: [] }
      return
    }
    const th = testHandling(ied, frame)
    const tal = frame.pdu.timeAllowedtoLive
    s.lastSt = frame.pdu.stNum
    s.lastSq = frame.pdu.sqNum
    s.deadline = t + tal / 1000
    if (s.status !== 'healthy') setStatus(sub, 'healthy', t)
    const dl = s.deadline
    const { stNum, sqNum } = frame.pdu
    q.push(dl, () => {
      if (subs[sub.id].deadline === dl && subs[sub.id].status === 'healthy') {
        setStatus(sub, 'stale', dl, `no message within TAL (${tal} ms) of stNum ${stNum} sqNum ${sqNum}`)
      }
    })
    const isNew = seq.kind === 'new' && th.use
    frame.rx[sub.id] = { fate: isNew ? 'new' : 'repeat', t, reason: seq.note ?? th.note, compare: [] }
    if (isNew) {
      const g = cfg.gocbs.find(x => x.id === sub.gocb)
      log(t, 'accept', `${sub.ied} accepts ${g.label} stNum ${stNum} (${valueText(frame)})`, sub.ied, { sub: sub.id, frame: frame.id })
      q.push(t + subS, () => apply(sub, frame, t + subS))
    }
  }

  // The subscribing IED's logic acts on new data
  function apply(sub, frame, t) {
    const st = ieds[sub.ied]
    if (sub.use === 'tripCoil') {
      const tr = frame.pdu.allData.find(d => d.type === 'BOOLEAN')?.value ?? false
      st.tripIn = tr
      if (tr && st.contactsClosed && !st.coil) energizeCoil(sub.ied, t)
    }
    if (sub.use === 'breakerPos') {
      const pos = frame.pdu.allData.find(d => d.type === 'Dbpos')?.value
      st.seenPos = pos
      const pub = cfg.gocbs.find(x => x.id === sub.gocb).ied
      log(t, 'seen', `${sub.ied} sees ${pub} ${DBPOS_TEXT[pos] ?? pos}`, sub.ied)
    }
  }

  // ── Breaker ──
  function energizeCoil(bkr, t) {
    const st = ieds[bkr]
    st.coil = true
    log(t, 'coil', `${bkr} energizes the trip coil`, bkr)
    q.push(t + T.auxMoveMs / 1000, () => {
      st.pos = 'intermediate'
      log(t + T.auxMoveMs / 1000, 'pos', `${bkr} position: intermediate (mechanism moving)`, bkr)
      dataChanged(bkr, 'pos', t + T.auxMoveMs / 1000)
    })
    const tOpen = t + T.breakerOpenCycles / f
    q.push(tOpen, () => {
      st.contactsClosed = false
      st.coil = false
      log(tOpen, 'open', `${bkr} main contacts part: breaker open, trip coil de-energized`, bkr)
      // Relays in the same bay see the current go: their trip resets
      const bay = iedById(cfg, bkr).bay
      for (const r of cfg.ieds.filter(d => d.kind === 'relay' && d.bay === bay && ieds[d.id].trip)) {
        const tr = tOpen + T.tripResetCycles / f
        q.push(tr, () => {
          ieds[r.id].trip = false
          log(tr, 'reset', `${r.id} trip resets (no current)`, r.id)
          dataChanged(r.id, 'trip', tr)
        })
      }
    })
    const tOff = tOpen + T.auxSettleMs / 1000
    q.push(tOff, () => {
      st.pos = 'off'
      log(tOff, 'pos', `${bkr} position: open`, bkr)
      dataChanged(bkr, 'pos', tOff)
    })
  }

  // ── Script ──
  cfg.gocbs.forEach((g, i) => {
    const hb = prof.heartbeatMs / 1000
    const phase = heartbeatPhase(i)
    const first = phase - Math.floor((phase - WARM_T) / hb) * hb
    q.push(first, () => send(g, first, Infinity))
  })
  q.push(START_T, () => {
    log(START_T, 'start', 'Quiet period: each publisher sends a heartbeat every second', null)
    for (const sub of cfg.subscriptions) {
      const s = subs[sub.id]
      if (s.status !== 'healthy') {
        const g = cfg.gocbs.find(x => x.id === sub.gocb)
        log(START_T, 'alarm', `${sub.ied}: ${g.label} subscription alarm standing: ${s.reason}`, sub.ied, { sub: sub.id })
      }
    }
  })
  for (const [link, t] of Object.entries(scenario.linkDown)) {
    if (t === null || t === undefined) continue
    if (t >= START_T) q.push(t, () => log(t, 'link', `Link ${link} goes down`, null, { link }))
  }
  q.push(0, () => { fault = true; log(0, 'fault', 'Fault on line A–B', null) })
  for (const r of cfg.ieds.filter(d => d.kind === 'relay')) {
    const tt = T.relayTripCycles / f
    q.push(tt, () => {
      ieds[r.id].trip = true
      log(tt, 'trip', `${r.id} trips (PTRC Tr.general = true)`, r.id)
      dataChanged(r.id, 'trip', tt)
    })
  }

  while (q.size && q.peekT() <= END_T + EPS) q.pop().fn()

  const shown = frames.filter(fr => fr.sendT >= START_T - EPS)
  shown.forEach((fr, i) => { fr.no = i + 1 })
  for (const fr of shown) for (const rx of Object.values(fr.rx)) if (rx.fate === 'pending') rx.fate = 'inFlight'
  const outcome = judge(cfg, events, shown)
  return { events, frames: shown, outcome, startT: START_T, endT: END_T, config: cfg, profile: prof }
}

export function valueText(frame) {
  return frame.pdu.allData.filter(d => d.type !== 'Quality').map(d => {
    const name = d.ref.split('/').pop()
    return d.type === 'Dbpos' ? `${name} = ${d.value}` : `${name} = ${d.value}`
  }).join(', ')
}

// ── Outcome ──
function judge(cfg, events, frames) {
  const f = cfg.freqHz
  const notes = []
  const tripEv = events.find(e => e.kind === 'trip')
  const coilEv = events.find(e => e.kind === 'coil')
  const openEv = events.find(e => e.kind === 'open')
  const tripSub = cfg.subscriptions.find(s => s.use === 'tripCoil')
  const tripGocb = cfg.gocbs.find(g => g.id === tripSub?.gocb)
  const tripFrames = frames.filter(fr => fr.gocb === tripGocb?.id && tripEv && fr.sendT >= tripEv.t && fr.pdu.allData.some(d => d.type === 'BOOLEAN' && d.value))
  const out = { tripT: tripEv?.t ?? null, coilT: coilEv?.t ?? null, openT: openEv?.t ?? null, classMs: TRIP_CLASS.ms, className: TRIP_CLASS.name, freqHz: f, notes }

  if (coilEv && tripEv) {
    const by = frames.find(fr => fr.rx[tripSub.id]?.fate === 'new' && tripFrames.includes(fr))
    out.transferT = coilEv.t - tripEv.t
    out.deliveredBy = by ? { no: by.no, st: by.pdu.stNum, sq: by.pdu.sqNum } : null
    out.budget = by && {
      publishS: cfg.stack.publishMs / 1000,
      waitS: by.sendT - (tripEv.t + cfg.stack.publishMs / 1000),
      networkS: by.rx[tripSub.id].t - by.sendT,
      subscribeS: cfg.stack.subscribeMs / 1000,
    }
    out.verdict = out.transferT * 1000 <= TRIP_CLASS.ms + 1e-9 ? 'delivered' : 'late'
    if (by && by.pdu.sqNum > 0) {
      const n = by.pdu.sqNum
      notes.push({ level: 'warn', text: `${n === 1 ? 'The first frame' : `The first ${n} frames`} after the trip never arrived; retransmission sqNum ${n} delivered the trip ${fmtDur(out.budget.waitS)} later.` })
    }
    notes.push({ level: out.verdict === 'delivered' ? 'info' : 'warn',
      text: `Transfer time ${fmtDur(out.transferT)}: ${out.verdict === 'delivered' ? 'inside' : 'beyond'} the ${TRIP_CLASS.ms} ms class for trip messages (${TRIP_CLASS.name}).` })
  } else if (tripEv) {
    out.verdict = 'notDelivered'
    const first = tripFrames[0]
    const rx = first?.rx[tripSub.id]
    if (rx) notes.push({ level: 'bad', text: `Every trip frame failed at ${tripSub.ied}. The first one: ${rx.reason}.` })
    notes.push({ level: 'bad', text: `The breaker stayed closed. Breaker failure protection or remote backup has to clear the fault, much later (the Line Protection Simulator shows that part).` })
  }

  // Supervision: what warned, and when
  for (const sub of cfg.subscriptions) {
    const g = cfg.gocbs.find(x => x.id === sub.gocb)
    const al = events.filter(e => e.sub === sub.id && ['alarm', 'stale', 'mismatch'].includes(e.kind))
    for (const e of al) {
      const when = e.kind === 'alarm' ? 'standing since before the run' : `at ${fmtTime(e.t)}${tripEv && e.t < tripEv.t ? `, ${fmtDur(tripEv.t - e.t)} before the trip` : ''}`
      notes.push({ level: 'warn', text: `Alarm, ${sub.ied} ${g.label} subscription: ${when}.` })
    }
  }
  const silent = out.verdict === 'notDelivered' && !events.some(e => e.sub === tripSub.id && ['alarm', 'stale', 'mismatch'].includes(e.kind))
  if (silent) notes.push({ level: 'bad', text: 'No alarm warned of it.' })
  return out
}

export function stateAt(events, t) {
  let idx = 0
  for (let i = 0; i < events.length; i++) if (events[i].t <= t + EPS) idx = i
  return { idx, state: events[idx].state }
}

export { fmtAppid }
