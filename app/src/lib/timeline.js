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
import { buildTopo, forward, parseEnd } from './network'
import { buildFrame, datasetValues, matchFrame, sequenceCheck, testHandling, fmtAppid } from './goose'
import { fmtTime, fmtDur, fmtProt } from './units'

export const START_T = -3.0 // run shown from here (quiet period)
export const END_T = 2.5
const WARM_T = -6.0 // simulated but not shown: publishers and subscribers settle into steady state
export const EPS = 1e-9

// Heartbeat phase of each control block: frames at phase − k·heartbeat,
// spread so the publishers don't send at the same instant.
const PHASES = [-0.6, -0.3, -0.45, -0.15, -0.75, -0.9]
const heartbeatPhase = i => PHASES[i % PHASES.length]

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
  // Test set: a simulated copy of one control block, same identity, simulation flag set
  const tsIed = cfg.ieds.find(d => d.kind === 'testset')
  if (tsIed && scenario.testSet?.imitate) {
    const g = cfg.gocbs.find(x => x.id === scenario.testSet.imitate)
    if (g) cfg.gocbs.push({ ...structuredClone(g), id: `${g.id}.sim`, ied: tsIed.id, label: `${g.label} (simulated)`, simOf: g.id, port: undefined })
  }
  const subsFor = g => subsOfGocb(cfg, g.simOf ?? g.id)
  // PRP: which LAN each switch belongs to, and which IEDs are attached to both
  const lanOf = sw => cfg.switches.find(x => x.id === sw)?.lan ?? null
  const lansOfIed = {}
  for (const l of cfg.links) {
    const [a, b] = [l.a, l.b].map(parseEnd)
    for (const [x, y] of [[a, b], [b, a]]) {
      const lan = lanOf(y.dev)
      if (lan) (lansOfIed[x.dev] ??= new Set()).add(lan)
    }
  }
  const danps = Object.keys(lansOfIed).filter(id => lansOfIed[id].size === 2)
  const lifeCheck = (cfg.network.prpLifeCheckMs ?? 2000) / 1000
  const rctSeq = {}
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
    ieds[d.id] = d.kind === 'relay' ? { trip: false, bf: false, seenPos: null }
      : d.kind === 'breaker' ? { pos: 'on', coil: false, contactsClosed: true, tripIn: null }
      : d.kind === 'testset' ? { trip: false, pos: 'on', bf: false }
      : {}
  }
  const subs = Object.fromEntries(cfg.subscriptions.map(s => [s.id,
    { status: 'noMsg', since: WARM_T, reason: 'no valid message received since start-up', lastSt: null, lastSq: null, deadline: null, simLocked: false }]))
  const pubs = Object.fromEntries(cfg.gocbs.map(g => [g.id,
    { stNum: 1, sqNum: 0, changeT: WARM_T, gen: 0, values: datasetValues(g, ieds[g.ied], iedById(cfg, g.ied)) }]))
  let fault = false
  // PRP supervision per doubly attached node: last frame seen on each LAN
  const prp = Object.fromEntries(danps.map(id => [id, { A: 'ok', B: 'ok' }]))
  const lastSeen = Object.fromEntries(danps.map(id => [id, { A: WARM_T, B: WARM_T }]))

  const snapshot = () => structuredClone({ fault, ieds, subs, prp, pubs: Object.fromEntries(Object.entries(pubs).map(([k, p]) => [k, { stNum: p.stNum, sqNum: p.sqNum }])) })
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
    // PRP: a doubly attached publisher sends each frame on both LANs with a 6-byte trailer
    if (danps.includes(ied.id)) {
      frame.length += 6
      rctSeq[ied.id] = ((rctSeq[ied.id] ?? 0) + 1) % 65536
      frame.rct = { seq: rctSeq[ied.id], suffix: 0x88fb }
    }
    const r = forward(topo, cfg, scenario, frame, t)
    for (const a of r.arrivals) prpSeen(a.ied, lanOf(a.via), a.t)
    frame.hops = r.hops
    frame.rx = {}
    // IEDs the frame reached that have no subscription for it: they drop it quietly
    const subscribed = new Set(subsFor(g).map(s => s.ied))
    frame.unsubscribed = r.arrivals.filter(a => !subscribed.has(a.ied)).map(a => a.ied)
    for (const sub of subsFor(g)) {
      // With PRP two copies may arrive: the first is used, the other discarded as a duplicate
      const arr = r.arrivals.filter(x => x.ied === sub.ied).sort((x, y) => x.t - y.t)
      const a = arr[0]
      if (danps.includes(sub.ied)) {
        frame.copies ??= {}
        frame.copies[sub.id] = ['A', 'B'].map(lan => {
          const c = arr.find(x => lanOf(x.via) === lan)
          if (c) return { lan, t: c.t, used: c === a }
          const loss = r.losses.find(x => x.ied === sub.ied && lanOfLink(x.link) === lan)
          return { lan, t: null, lost: loss?.where ?? 'no path' }
        })
      }
      if (a) {
        frame.rx[sub.id] = { fate: 'pending', t: a.t, lan: lanOf(a.via) }
        q.push(a.t, () => receive(sub, frame, a.t))
      } else {
        const ls = r.losses.filter(x => x.ied === sub.ied)
        const wheres = [...new Set(ls.map(x => `${x.where}${lanOfLink(x.link) ? ` (LAN ${lanOfLink(x.link)})` : ''}`))]
        frame.rx[sub.id] = { fate: 'lost', t: null, kind: ls[0]?.kind ?? 'nopath', reason: ls.length ? `never arrived: ${wheres.join('; ')}` : 'never arrived: no path' }
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

  function lanOfLink(linkId) {
    const l = cfg.links.find(x => x.id === linkId)
    if (!l) return null
    return [l.a, l.b].map(e => lanOf(parseEnd(e).dev)).find(Boolean) ?? null
  }

  // PRP supervision: a LAN silent for the life-check interval raises an alarm
  function prpSeen(ied, lan, t) {
    if (!lan || !prp[ied]) return
    lastSeen[ied][lan] = t
    if (prp[ied][lan] !== 'ok') {
      prp[ied][lan] = 'ok'
      log(t, 'prpOk', `${ied}: frames on LAN ${lan} again`, ied)
    }
    const due = t + lifeCheck
    q.push(due, () => {
      if (lastSeen[ied][lan] === t && prp[ied][lan] === 'ok') {
        prp[ied][lan] = 'lost'
        const other = lan === 'A' ? 'B' : 'A'
        log(due, 'prpLan', `${ied}: nothing received on LAN ${lan} for ${lifeCheck * 1000} ms. PRP alarm: still protected over LAN ${other}, but no longer redundant`, ied, { lan })
      }
    })
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
    // Simulated messages: ignored outright unless this IED is in simulation mode.
    // In simulation mode, once a simulated copy arrives, the real message is ignored.
    const gSub = cfg.gocbs.find(x => x.id === sub.gocb)
    if (frame.pdu.simulation && !ied.lphdSim) {
      frame.rx[sub.id] = { fate: 'simIgnored', t, reason: 'simulated message ignored: this IED is not in simulation mode', compare: [] }
      return
    }
    if (ied.lphdSim && frame.pdu.simulation && !s.simLocked) {
      s.simLocked = true
      s.lastSt = null
      s.lastSq = null
      log(t, 'simLock', `${sub.ied} (simulation mode) now takes ${gSub.label} from the test set; the real ${gSub.label} is ignored`, sub.ied, { sub: sub.id })
    }
    if (ied.lphdSim && !frame.pdu.simulation && s.simLocked) {
      frame.rx[sub.id] = { fate: 'realIgnored', t, reason: `real message ignored: ${sub.ied} is in simulation mode and takes this message from the test set`, compare: [] }
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
    frame.rx[sub.id] = { fate: !th.use ? 'testIgnored' : isNew ? 'new' : 'repeat', t, reason: th.note ?? seq.note, compare: [] }
    const g = cfg.gocbs.find(x => x.id === sub.gocb)
    if (seq.kind === 'new' && !th.use) {
      log(t, 'testIgnored', `${sub.ied} receives ${g.label} stNum ${stNum} but does not use it: ${th.note}`, sub.ied, { sub: sub.id, frame: frame.id })
    }
    if (isNew) {
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
      if (tr && st.contactsClosed && !st.coil) {
        const g = cfg.gocbs.find(x => x.id === sub.gocb)
        if (iedById(cfg, sub.ied).mode === 'test/blocked') {
          log(t, 'blocked', `${sub.ied} (test/blocked) processes the ${g.label.toLowerCase()} but its output stays blocked: trip coil not energized`, sub.ied)
        } else energizeCoil(sub.ied, t, g)
      }
    }
    if (sub.use === 'breakerPos') {
      const pos = frame.pdu.allData.find(d => d.type === 'Dbpos')?.value
      st.seenPos = pos
      const pub = cfg.gocbs.find(x => x.id === sub.gocb).ied
      log(t, 'seen', `${sub.ied} sees ${pub} ${DBPOS_TEXT[pos] ?? pos}`, sub.ied)
    }
  }

  // ── Breaker ──
  function energizeCoil(bkr, t, g) {
    const st = ieds[bkr]
    st.coil = true
    log(t, 'coil', `${bkr} energizes the trip coil${g && g.label !== 'Trip' ? ` (${g.label} from ${g.ied})` : ''}`, bkr)
    if (scenario.breakerStuck.includes(bkr)) {
      log(t, 'stuck', `${bkr}: the trip coil is energized but the breaker does not move (stuck mechanism)`, bkr)
      return
    }
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
  // A LAN that never carried anything (down from the start) is silent from boot
  for (const id of danps) for (const lan of ['A', 'B']) {
    const due = WARM_T + lifeCheck
    q.push(due, () => { if (lastSeen[id][lan] === WARM_T && prp[id][lan] === 'ok') prp[id][lan] = 'lost' })
  }
  q.push(START_T, () => {
    log(START_T, 'start', 'Quiet period: each publisher sends a heartbeat every second', null)
    for (const id of danps) for (const lan of ['A', 'B']) {
      if (prp[id][lan] === 'lost') log(START_T, 'prpLan', `${id}: PRP alarm standing: nothing received on LAN ${lan}`, id, { lan })
    }
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
  for (const [sw, t] of Object.entries(scenario.switchDown)) {
    if (t === null || t === undefined) continue
    if (t >= START_T) q.push(t, () => log(t, 'link', `Switch ${sw} fails`, null, { sw }))
  }
  if (tsIed && scenario.testSet?.imitate && scenario.testSet.tripAt !== null && scenario.testSet.tripAt !== undefined) {
    const ta = scenario.testSet.tripAt
    q.push(ta, () => {
      ieds[tsIed.id].trip = true
      log(ta, 'testset', `Test set injects a simulated trip (imitating ${cfg.gocbs.find(x => x.id === scenario.testSet.imitate)?.ied})`, tsIed.id)
      dataChanged(tsIed.id, 'trip', ta)
    })
  }
  const faultLine = cfg.script?.faultLine ?? 'AB'
  q.push(0, () => { fault = true; log(0, 'fault', `Fault on line ${faultLine[0]}–${faultLine[1]}`, null) })
  for (const r of cfg.ieds.filter(d => d.kind === 'relay' && (d.line ?? d.bay) === faultLine)) {
    const tt = T.relayTripCycles / f
    q.push(tt, () => {
      ieds[r.id].trip = true
      log(tt, 'trip', `${r.id} trips (PTRC Tr.general = true)`, r.id)
      dataChanged(r.id, 'trip', tt)
    })
    // Breaker failure: if current still flows (own breaker still closed) when the timer runs out
    if (r.bf) {
      const tb = tt + (T.bfCycles ?? 8) / f
      q.push(tb, () => {
        const bkr = cfg.ieds.find(d => d.kind === 'breaker' && d.bay === r.bay)
        if (ieds[r.id].trip && bkr && ieds[bkr.id].contactsClosed) {
          ieds[r.id].bf = true
          log(tb, 'bf', `${r.id} breaker failure: current still flowing ${T.bfCycles ?? 8} cycles after the trip. BF trip (RBRF1.OpEx) to the other breakers on bus A`, r.id)
          dataChanged(r.id, 'bf', tb)
        }
      })
    }
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
  const faultLine = cfg.script?.faultLine ?? 'AB'
  const relay = cfg.ieds.find(d => d.kind === 'relay' && (d.line ?? d.bay) === faultLine)
  const bkr = cfg.ieds.find(d => d.kind === 'breaker' && d.bay === relay?.bay)
  const tripGocb = cfg.gocbs.find(g => g.ied === relay?.id && g.entries.some(e => e.signal === 'trip'))
  const tripSub = cfg.subscriptions.find(s => s.gocb === tripGocb?.id && s.ied === bkr?.id)
  const tripEv = events.find(e => e.kind === 'trip' && e.dev === relay?.id)
  // Device events from the trip on (a test set may operate the breaker before the fault)
  const at = (kind, dev) => events.find(e => e.kind === kind && e.dev === dev && (!tripEv || e.t >= tripEv.t))
  const coilEv = at('coil', bkr?.id)
  const openEv = at('open', bkr?.id)
  const preOpen = tripEv && events.find(e => e.kind === 'open' && e.dev === bkr?.id && e.t < tripEv.t)
  const stuckEv = at('stuck', bkr?.id)
  const blockedEv = at('blocked', bkr?.id)
  const bfEv = at('bf', relay?.id)
  const tripFrames = frames.filter(fr => fr.gocb === tripGocb?.id && tripEv && fr.sendT >= tripEv.t && fr.pdu.allData.some(d => d.type === 'BOOLEAN' && d.value))
  const out = { tripT: tripEv?.t ?? null, coilT: coilEv?.t ?? null, openT: openEv?.t ?? null, bfT: bfEv?.t ?? null, clearT: openEv?.t ?? null, bfOpens: [],
    classMs: TRIP_CLASS.ms, className: TRIP_CLASS.name, freqHz: f, notes, relay: relay?.id, breaker: bkr?.id }

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
    if (by && by.pdu.sqNum > 0) {
      const n = by.pdu.sqNum
      notes.push({ level: 'warn', text: `${n === 1 ? 'The first frame' : `The first ${n} frames`} after the trip never arrived; retransmission sqNum ${n} delivered the trip ${fmtDur(out.budget.waitS)} later.` })
    }
    const inClass = out.transferT * 1000 <= TRIP_CLASS.ms + 1e-9
    notes.push({ level: inClass ? 'info' : 'warn',
      text: `Transfer time ${fmtDur(out.transferT)}: ${inClass ? 'inside' : 'beyond'} the ${TRIP_CLASS.ms} ms class for trip messages (${TRIP_CLASS.name}).` })
    out.verdict = inClass ? 'delivered' : 'late'
  }

  if (preOpen) {
    out.verdict = 'openBefore'
    out.openT = preOpen.t
    notes.push({ level: 'warn', text: `${bkr.id} opened at ${fmtTime(preOpen.t)}, before the fault, on the test set’s simulated trip: the test reached the breaker. A test like this is done with the breaker isolated, or with ${bkr.id} in test/blocked.` })
  } else if (tripEv && !openEv) {
    // The faulted line's own breaker never opened
    if (stuckEv) notes.push({ level: 'bad', text: `${bkr.id} received the trip, but its breaker is stuck: the contacts never part.` })
    else if (blockedEv) notes.push({ level: 'bad', text: `${bkr.id} is in test/blocked: it processed the trip, but its output is blocked and the breaker stays closed.` })
    else if (!coilEv) {
      const rx = tripFrames[0]?.rx[tripSub.id]
      if (relay.mode === 'test' || relay.mode === 'test/blocked') notes.push({ level: 'bad', text: `${relay.id} is in ${relay.mode}: its trip carries the test flag.` })
      if (bkr.lphdSim) notes.push({ level: 'bad', text: `${bkr.id} is in simulation mode with a test set still publishing: it takes the trip message from the test set and ignores the real one.` })
      if (rx) notes.push({ level: 'bad', text: `Every trip frame failed at ${tripSub.ied}. The first one: ${rx.reason}.` })
    }
    if (bfEv) {
      const bfGocb = cfg.gocbs.find(g => g.ied === relay.id && g.entries.some(e => e.signal === 'bf'))
      const needed = cfg.subscriptions.filter(s => s.gocb === bfGocb?.id && s.use === 'tripCoil').map(s => s.ied)
      out.bfOpens = needed.map(id => ({ dev: id, t: events.find(e => e.kind === 'open' && e.dev === id)?.t ?? null }))
      notes.push({ level: 'warn', text: `${relay.id} breaker failure trip at ${fmtProt(bfEv.t, f)}${needed.length ? `, to ${needed.join(', ')}` : ''}.` })
      const missing = out.bfOpens.filter(o => o.t === null).map(o => o.dev)
      if (!needed.length) {
        out.verdict = coilEv ? 'notCleared' : 'notDelivered'
        const reached = [...new Set(frames.filter(fr => fr.gocb === bfGocb?.id).flatMap(fr => fr.unsubscribed ?? []))].filter(id => id !== bkr.id && cfg.ieds.find(d => d.id === id)?.kind === 'breaker')
        notes.push({ level: 'bad', text: `No IED subscribes to ${relay.id}'s BF trip. ${reached.length ? `It reaches ${reached.join(' and ')}, ${reached.length > 1 ? 'which drop' : 'which drops'} it quietly. ` : ''}The fault is not cleared from bus A, and no alarm says so: there is no subscription to supervise.` })
      } else if (!missing.length) {
        out.clearT = Math.max(...out.bfOpens.map(o => o.t))
        out.verdict = 'clearedByBF'
        notes.push({ level: 'warn', text: `Bus A side cleared by breaker failure at ${fmtProt(out.clearT, f)}: ${needed.join(' and ')} opened, taking bus A out of service. The far end (B) is not modelled.` })
      } else {
        out.verdict = coilEv ? 'notCleared' : 'notDelivered'
        notes.push({ level: 'bad', text: `The breaker failure trip did not open ${missing.join(', ')}: the fault is not cleared from bus A. Remote backup at the far ends has to clear it.` })
      }
    } else {
      out.verdict = 'notDelivered'
      notes.push({ level: 'bad', text: 'The breaker stayed closed. Breaker failure protection or remote backup has to clear the fault, much later (the Line Protection Simulator shows that part).' })
    }
  }

  // PRP: what the redundancy did and what it reported
  if (out.deliveredBy && tripSub) {
    const fr = frames.find(x => x.no === out.deliveredBy.no)
    const cp = fr?.copies?.[tripSub.id]
    const lostCopy = cp?.find(c => c.t === null)
    if (lostCopy) notes.push({ level: 'info', text: `PRP: the LAN ${lostCopy.lan} copy of the trip was lost (${lostCopy.lost}); the LAN ${lostCopy.lan === 'A' ? 'B' : 'A'} copy delivered it with no delay.` })
  }
  const prpAlarms = events.filter(e => e.kind === 'prpLan')
  for (const e of prpAlarms) {
    const when = e.t <= START_T + 1e-9 ? 'standing since before the run' : `at ${fmtTime(e.t)}`
    notes.push({ level: 'warn', text: `PRP alarm, ${e.dev}: LAN ${e.lan} silent, ${when}.` })
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
  const silent = out.verdict !== 'delivered' && out.verdict !== 'late' && tripSub && !events.some(e => e.sub === tripSub.id && ['alarm', 'stale', 'mismatch'].includes(e.kind))
  const why = bkr?.lphdSim ? `: ${tripSub.ied}'s subscription stayed healthy, fed by the test set. Only ${bkr.id}'s simulation mode, on its display and the HMI, showed it`
    : relay?.mode !== 'on' ? `: ${tripSub.ied}'s subscription stayed healthy. Only ${relay.id}'s mode, on its display and the HMI, showed it` : ''
  if (silent && !stuckEv) notes.push({ level: 'bad', text: `No alarm warned of it${why}.` })
  return out
}

export function stateAt(events, t) {
  let idx = 0
  for (let i = 0; i < events.length; i++) if (events[i].t <= t + EPS) idx = i
  return { idx, state: events[idx].state }
}

export { fmtAppid }
