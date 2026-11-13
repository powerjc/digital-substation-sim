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
import { ptpModel } from './ptp'

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
  // A node is keyed by its IED, or "<ied>@S" for a relay's station port (port S)
  const lansOfIed = {}
  const nodeOf = {} // key → { dev, port prefix, frames: supervised by PRP supervision frames }
  for (const l of cfg.links) {
    const [a, b] = [l.a, l.b].map(parseEnd)
    for (const [x, y] of [[a, b], [b, a]]) {
      const lan = lanOf(y.dev)
      if (!lan) continue
      const pf = String(x.port ?? '').split('.')[0]
      const key = pf === 'S' ? `${x.dev}@S` : x.dev
      ;(lansOfIed[key] ??= new Set()).add(lan)
      nodeOf[key] = { dev: x.dev, port: pf === 'S' || pf === 'P' ? pf : null, frames: cfg.switches.find(sw => sw.id === y.dev)?.prpSupervision === 'frames' }
    }
  }
  const danps = Object.keys(lansOfIed).filter(id => lansOfIed[id].size === 2)
  const nodeName = k => (k.endsWith('@S') ? `${nodeOf[k].dev} (station port)` : k)
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
    ieds[d.id] = d.kind === 'relay' ? { trip: false, bf: false, seenPos: null, ...((cfg.ctls ?? []).some(c => c.ied === d.id) ? { opnCmd: false, clsCmd: false } : {}) }
      : d.kind === 'breaker' ? { pos: 'on', coil: false, contactsClosed: true, tripIn: null, closing: false }
      : d.kind === 'testset' ? { trip: false, pos: 'on', bf: false }
      : {}
  }
  const subs = Object.fromEntries(cfg.subscriptions.map(s => [s.id,
    { status: 'noMsg', since: WARM_T, reason: 'no valid message received since start-up', lastSt: null, lastSq: null, deadline: null, simLocked: false }]))
  const pubs = Object.fromEntries(cfg.gocbs.map(g => [g.id,
    { stNum: 1, sqNum: 0, changeT: WARM_T, gen: 0, values: datasetValues(g, ieds[g.ied], iedById(cfg, g.ied)) }]))
  let fault = false
  // ── Sampled Values: when each relay's stream is good, from the network path
  // and the merging unit's own state; samples are synthesized only for display ──
  // ── Time sync: grandmasters and each merging unit's smpSynch over time ──
  const gmIeds = cfg.ieds.filter(d => d.kind === 'gm')
  const rstpCuts = cfg.links.filter(x => x.rstp === 'standby').map(l => scenario.linkDown[l.backs]).filter(Number.isFinite).map(d => d + (cfg.network.rstpRecoveryMs ?? 50) / 1000)
  const netCuts = [...Object.values(scenario.linkDown), ...Object.values(scenario.switchDown), ...Object.values(scenario.linkUp ?? {}), ...Object.values(scenario.switchUp ?? {})].filter(Number.isFinite).concat(rstpCuts)
  const ptp = gmIeds.length && cfg.ptp ? ptpModel({
    gms: gmIeds.map(g => ({ id: g.id, priority2: g.priority2 ?? 1 })),
    mus: cfg.ieds.filter(d => d.kind === 'mu').map(d => d.id),
    ptpCfg: cfg.ptp, scGm: scenario.gm ?? {}, startT: WARM_T, extraCuts: netCuts,
    reach: (g, m, t) => forward(topo, cfg, scenario, { pub: g, gocb: 'PTP', dst: '01-1B-19-00-00-00', vlan: { id: 10, priority: 4 }, length: 64, pdu: { stNum: 0, sqNum: 0 }, port: null }, t).arrivals.some(a => a.ied === m),
  }) : null
  let ptpNow = ptp ? ptp.gmAt(WARM_T) : null

  const sv = {}       // subId → { status, synch, reason } (in snapshots)
  const svHealth = {} // subId → [{ t0, t1, arriving, frozenAt, invalid, synch, reason }]
  for (const sub of cfg.svSubs ?? []) {
    const cb = cfg.svcbs.find(x => x.id === sub.sv)
    const flt = scenario.svFault?.[cb.id]
    const ts = new Set([WARM_T, 0])
    for (const t of netCuts) ts.add(t)
    for (const l of cfg.links.filter(x => x.rstp === 'standby')) {
      const d = scenario.linkDown[l.backs]
      if (Number.isFinite(d)) ts.add(d + (cfg.network.rstpRecoveryMs ?? 50) / 1000)
    }
    if (flt && Number.isFinite(flt.at)) ts.add(flt.at)
    for (const t of ptp?.cuts ?? []) ts.add(t)
    const times = [...ts].filter(t => t >= WARM_T).sort((a, b) => a - b)
    svHealth[sub.id] = times.map((t0, i) => {
      const probe = { pub: cb.ied, gocb: cb.id, dst: cb.mac, vlan: cb.vlan, length: cb.length, pdu: { stNum: 0, sqNum: 0 }, port: null }
      const r = forward(topo, cfg, scenario, probe, t0 + 1e-9)
      const reaches = r.arrivals.some(a => a.ied === sub.ied)
      const loss = r.losses.find(x => x.ied === sub.ied)
      const on = k => flt?.kind === k && t0 >= flt.at - 1e-12
      return {
        t0, t1: times[i + 1] ?? Infinity,
        arriving: reaches && !on('stop'), frozenAt: on('freeze') ? flt.at : null, invalid: on('invalid'),
        synch: on('sync') ? 0 : ptp ? ptp.synchAt(cb.ied, t0 + 1e-9) : 2,
        reason: on('stop') ? `${cb.ied} stopped sending` : !reaches ? (loss?.where ?? 'no path') : on('freeze') ? 'the sample counter stopped advancing (frozen samples)' : on('invalid') ? 'samples flagged invalid' : null,
      }
    })
    sv[sub.id] = { status: 'healthy', synch: 2, reason: null }
  }
  const svGood = h => h.arriving && h.frozenAt === null && !h.invalid
  const svStatusOf = h => (!h.arriving ? 'lost' : h.frozenAt !== null ? 'frozen' : h.invalid ? 'invalid' : 'healthy')
  // PRP supervision per doubly attached node: last frame seen on each LAN
  const prp = Object.fromEntries(danps.map(id => [id, { A: 'ok', B: 'ok' }]))
  const lastSeen = Object.fromEntries(danps.map(id => [id, { A: WARM_T, B: WARM_T }]))

  // ── MMS (feature mms): reports from each relay to the gateway over the station bus ──
  const rcbs = cfg.rcbs ?? []
  const M = cfg.mms ?? { serverMs: 5, assocTimeoutS: 1, reconnectS: 0.3 }
  const mms = {}   // relay → { assoc: 'up' | 'lost' | 'connecting', queued, buffered } (in snapshots)
  const scada = {} // relay → what the gateway last heard: { trip, bf, pos, t, stale } (in snapshots)
  const reports = []
  const rcbSt = {}
  // The VLAN a device's port sits in (from the switch port it connects to)
  const portVlan = (dev, pf) => {
    for (const l of cfg.links) for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
      const e = parseEnd(x)
      if (e.dev !== dev || (pf && !String(e.port ?? '').startsWith(pf))) continue
      const o = parseEnd(y)
      const v = cfg.switches.find(w => w.id === o.dev)?.ports[o.port]?.vlans?.[0]
      if (v) return v
    }
    return 0
  }
  // Network time of one report (TCP segment, ~200 bytes) from the relay to the gateway, or null if no path
  const mmsTransit = (rcb, t) => {
    const client = iedById(cfg, rcb.client)
    const r = forward(topo, cfg, scenario, { pub: rcb.ied, gocb: rcb.id, dst: client.mac, vlan: { id: portVlan(rcb.ied, rcb.port), priority: 0 }, length: 200, pdu: { stNum: 0, sqNum: 0 }, port: rcb.port }, t)
    const a = r.arrivals.filter(x => x.ied === rcb.client).sort((x, y) => x.t - y.t)[0]
    return a ? a.t - t : null
  }
  for (const rcb of rcbs) {
    const up = mmsTransit(rcb, WARM_T) !== null
    rcbSt[rcb.id] = { assoc: up ? 'up' : 'lost', queued: [], buffer: [], pend: [], seq: 0, downSince: up ? null : WARM_T, everUp: up }
    mms[rcb.ied] = { assoc: up ? 'up' : 'lost', queued: 0, buffered: 0, unbuffered: !rcb.buffered }
    scada[rcb.ied] = up ? { trip: false, bf: false, pos: null, t: null, stale: false } : { trip: null, bf: null, pos: null, t: null, stale: true }
  }

  // MMS controls (feature controls): the gateway operates a breaker through the
  // relay's CSWI, select before operate; the relay commands the breaker IED over GOOSE
  const ctls = cfg.ctls ?? []
  const ctl = Object.fromEntries(ctls.map(c => [c.ied, { phase: 'idle', op: null, cause: null }])) // in snapshots
  const ctlMsgs = []

  const snapshot = () => structuredClone({ fault, ieds, subs, prp, sv, mms, scada, ctl, ptp: ptpNow, pubs: Object.fromEntries(Object.entries(pubs).map(([k, p]) => [k, { stNum: p.stNum, sqNum: p.sqNum }])) })
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
    mmsChange(iedId, signal, t)
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
      const was = st.seenPos
      st.seenPos = pos
      if (pos !== was) mmsChange(sub.ied, 'pos', t)
      const pub = cfg.gocbs.find(x => x.id === sub.gocb).ied
      log(t, 'seen', `${sub.ied} sees ${pub} ${DBPOS_TEXT[pos] ?? pos}`, sub.ied)
      ctlPosSeen(sub.ied, pos, t)
    }
    // A control command from the relay's CSWI (feature controls)
    if (sub.use === 'control') {
      const val = ref => !!frame.pdu.allData.find(d => d.ref.endsWith(ref))?.value
      const g = cfg.gocbs.find(x => x.id === sub.gocb)
      const opn = val('OpOpn.general'), cls = val('OpCls.general')
      if ((opn && st.contactsClosed && !st.coil) || (cls && !st.contactsClosed && !st.closing)) {
        if (iedById(cfg, sub.ied).mode === 'test/blocked') log(t, 'blocked', `${sub.ied} (test/blocked) processes the ${opn ? 'open' : 'close'} command but its output stays blocked`, sub.ied)
        else if (opn) energizeCoil(sub.ied, t, g)
        else closeBreaker(sub.ied, t, g)
      }
    }
  }

  // ── Breaker ──
  function energizeCoil(bkr, t, g) {
    const st = ieds[bkr]
    st.coil = true
    log(t, 'coil', `${bkr} energizes the trip coil${g && g.label !== 'Trip' ? ` (${g.label === 'Control' ? 'open command' : g.label} from ${g.ied})` : ''}`, bkr)
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
      // With an operator command in the run, a line fault is transient: it goes
      // out once its own breakers are open (the far end is not modelled)
      if (fault && scenario.control && faultBkrs().length && faultBkrs().every(b => !ieds[b].contactsClosed)) {
        fault = false
        log(tOpen, 'faultGone', `The fault goes out with the line de-energized: a transient fault (the far end is not modelled)`, null)
      }
      // A relay's trip resets once every breaker its trip message opens is open (the current is gone)
      const tripsOf = rid => cfg.subscriptions.filter(s => s.use === 'tripCoil' && cfg.gocbs.find(g => g.id === s.gocb && g.ied === rid && g.entries.some(e => e.signal === 'trip'))).map(s => s.ied)
      for (const r of cfg.ieds.filter(d => d.kind === 'relay' && ieds[d.id].trip && tripsOf(d.id).includes(bkr) && tripsOf(d.id).every(b => !ieds[b].contactsClosed))) {
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

  // Closing: close coil, contacts make after the close time, then the position follows
  function closeBreaker(bkr, t, g) {
    const st = ieds[bkr]
    st.closing = true
    log(t, 'closeCoil', `${bkr} energizes the close coil (close command from ${g.ied})`, bkr)
    if (scenario.breakerStuck.includes(bkr)) {
      log(t, 'stuck', `${bkr}: the close coil is energized but the breaker does not move (stuck mechanism)`, bkr)
      return
    }
    const tm = t + T.auxMoveMs / 1000
    q.push(tm, () => {
      st.pos = 'intermediate'
      log(tm, 'pos', `${bkr} position: intermediate (mechanism moving)`, bkr)
      dataChanged(bkr, 'pos', tm)
    })
    const tc = t + (T.breakerCloseCycles ?? 5) / f
    q.push(tc, () => {
      st.contactsClosed = true
      st.closing = false
      log(tc, 'close', `${bkr} main contacts make: breaker closed, close coil de-energized`, bkr)
    })
    const tOn = tc + T.auxSettleMs / 1000
    q.push(tOn, () => {
      st.pos = 'on'
      log(tOn, 'pos', `${bkr} position: closed`, bkr)
      dataChanged(bkr, 'pos', tOn)
    })
  }

  // ── MMS ──
  const VAL_TEXT = (signal, v) => (signal === 'pos' ? DBPOS_TEXT[v] ?? String(v) : String(v))
  const syncMms = rcb => {
    const m = rcbSt[rcb.id]
    mms[rcb.ied] = { assoc: m.assoc, queued: m.queued.length, buffered: m.buffer.length, unbuffered: !rcb.buffered }
  }
  // A reported value changed in a relay: its report leaves after the server time
  function mmsChange(iedId, signal, t) {
    const rcb = rcbs.find(r => r.ied === iedId)
    const item = rcb?.items.find(x => x.signal === signal)
    if (!item) return
    const st = ieds[iedId]
    const value = signal === 'pos' ? st.seenPos : !!st[signal]
    const ts = t + M.serverMs / 1000
    q.push(ts, () => sendReport(rcb, item, value, t, ts))
  }
  function sendReport(rcb, item, value, tEvent, ts) {
    const m = rcbSt[rcb.id]
    const rec = { no: reports.length + 1, rcb: rcb.id, ied: rcb.ied, client: rcb.client, ref: item.ref, label: item.label, signal: item.signal,
      value, tEvent, tSent: ts, tRx: null, fate: null, seqNum: m.seq++, buffered: rcb.buffered }
    reports.push(rec)
    const tr = m.assoc === 'up' ? mmsTransit(rcb, ts) : null
    if (m.assoc === 'up' && tr !== null) {
      rec.fate = 'onTime'
      q.push(ts + tr, () => deliver(rcb, rec, ts + tr))
    } else if (m.assoc === 'up') {
      rec.fate = 'tcp' // no path: TCP keeps retransmitting the segment
      m.queued.push(rec)
    } else if (rcb.buffered) {
      rec.fate = 'buffer' // association down: the BRCB keeps the entry
      m.buffer.push(rec)
    } else {
      rec.fate = 'lost'
      rec.reason = 'its report is unbuffered, and nothing is kept while the association is down'
      log(ts, 'mmsDrop', `${rcb.ied}: ${item.label} = ${VAL_TEXT(item.signal, value)}, but the association is down and the report is unbuffered: this change is never reported`, rcb.ied, { rcb: rcb.id, report: rec.no })
    }
    syncMms(rcb)
  }
  function deliver(rcb, rec, t) {
    rec.tRx = t
    const sc = scada[rcb.ied]
    sc[rec.signal] = rec.value
    sc.t = rec.tEvent
    const late = rec.fate === 'tcp' ? `, by TCP retransmission ${fmtDur(t - rec.tEvent)} after the event` : rec.fate === 'buffer' ? `, from the report buffer ${fmtDur(t - rec.tEvent)} after the event` : ''
    log(t, 'report', `${rcb.client} receives a report from ${rcb.ied}: ${rec.ref.split('/').pop()} = ${VAL_TEXT(rec.signal, rec.value)} (time stamp ${fmtTime(rec.tEvent)})${late}`, rcb.client, { rcb: rcb.id, ied: rcb.ied, report: rec.no })
  }
  function assocLost(rcb, t) {
    const m = rcbSt[rcb.id]
    m.assoc = 'lost'
    scada[rcb.ied].stale = true
    let extra = ''
    if (m.queued.length) {
      if (rcb.buffered) { for (const r of m.queued) r.fate = 'buffer'; m.buffer.push(...m.queued) }
      else {
        for (const r of m.queued) { r.fate = 'lost'; r.reason = 'its unbuffered report was still in TCP when the connection was dropped, and was lost with it' }
        extra = ` ${m.queued.length} unbuffered report${m.queued.length > 1 ? 's' : ''} still in TCP ${m.queued.length > 1 ? 'are' : 'is'} lost with the connection.`
      }
      m.queued = []
    }
    syncMms(rcb)
    log(t, 'mmsLost', `${rcb.client}: no answer from ${rcb.ied} for ${M.assocTimeoutS} s, association lost. SCADA shows ${rcb.ied}'s data as not current. Alarm.${extra}`, rcb.client, { rcb: rcb.id, ied: rcb.ied })
    for (const p of m.pend) p.rec.fate = 'lost'
    m.pend = []
    const c = ctls.find(x => x.rcb === rcb.id)
    if (c && ['selecting', 'selected', 'operating'].includes(ctl[c.ied].phase)) ctlEnd(c, t, 'failed', 'association lost', `${rcb.client}: the ${ctl[c.ied].op} command to ${c.breaker} fails with the association: ${ctl[c.ied].phase === 'operating' ? 'no command termination received, the result is not known' : 'it never operated'}`)
  }
  function reconnect(rcb, t) {
    const m = rcbSt[rcb.id]
    const tr = mmsTransit(rcb, t)
    if (tr === null) { m.assoc = 'lost'; syncMms(rcb); return }
    m.assoc = 'up'
    m.everUp = true
    log(t, 'mmsOk', `${rcb.client} re-establishes the association with ${rcb.ied} and enables its ${rcb.buffered ? 'buffered' : 'unbuffered'} report${rcb.buffered && m.buffer.length ? `: ${m.buffer.length} buffered ${m.buffer.length > 1 ? 'entries follow' : 'entry follows'}` : ''}`, rcb.client, { rcb: rcb.id, ied: rcb.ied })
    for (const r of m.buffer) q.push(t + tr, () => deliver(rcb, r, t + tr))
    m.buffer = []
    syncMms(rcb)
    // General interrogation: the gateway reads the current values
    const tg = t + tr + 1e-4
    q.push(tg, () => {
      const st = ieds[rcb.ied]
      const sc = scada[rcb.ied]
      for (const it of rcb.items) sc[it.signal] = it.signal === 'pos' ? st.seenPos : !!st[it.signal]
      sc.stale = false
      log(tg, 'gi', `${rcb.client}: general interrogation of ${rcb.ied}, SCADA shows ${rcb.items.map(it => `${it.label} ${VAL_TEXT(it.signal, sc[it.signal])}`).join(', ')}`, rcb.client, { rcb: rcb.id, ied: rcb.ied })
    })
  }
  // ── MMS controls ──
  const serverS = M.serverMs / 1000
  const OP = { open: 'open', close: 'close' }
  const ctlTarget = op => (op === 'close' ? 'on' : 'off')
  // Network time of one control message from the gateway down to the relay, or null
  const mmsTransitDown = (rcb, t) => {
    const r = forward(topo, cfg, scenario, { pub: rcb.client, gocb: rcb.id, dst: iedById(cfg, rcb.ied).mac, vlan: { id: portVlan(rcb.client, null), priority: 0 }, length: 200, pdu: { stNum: 0, sqNum: 0 }, port: null }, t)
    const a = r.arrivals.filter(x => x.ied === rcb.ied).sort((x, y) => x.t - y.t)[0]
    return a ? a.t - t : null
  }
  // One MMS control message on the association; TCP holds it while there is no path
  function ctlSend(c, kind, t, onArrive, extra = {}) {
    const rcb = rcbs.find(r => r.id === c.rcb)
    const m = rcbSt[rcb.id]
    const down = !/[+−]/.test(kind)
    const rec = { no: ctlMsgs.length + 1, ied: c.ied, kind, from: down ? rcb.client : c.ied, to: down ? c.ied : rcb.client, tSent: t, tRx: null, fate: 'onTime', ...extra }
    ctlMsgs.push(rec)
    const go = ta => { rec.tRx = ta; onArrive(ta) }
    const tr = down ? mmsTransitDown(rcb, t) : mmsTransit(rcb, t)
    if (tr !== null) q.push(t + tr, () => go(t + tr))
    else { rec.fate = 'tcp'; m.pend.push({ rec, go }) }
    return rec
  }
  function ctlEnd(c, t, phase, cause, text) {
    const s = ctl[c.ied]
    s.phase = phase
    s.cause = cause
    for (const sig of ['opnCmd', 'clsCmd']) if (ieds[c.ied][sig]) { ieds[c.ied][sig] = false; dataChanged(c.ied, sig, t) }
    log(t, phase === 'done' ? 'ctlDone' : 'ctlFail', text, rcbs.find(r => r.id === c.rcb).client, { ied: c.ied })
  }
  // What the relay checks before it lets a command through
  function ctlCheck(c, op, stage) {
    const d = iedById(cfg, c.ied)
    if (d.mode === 'test' || d.mode === 'test/blocked') return { cause: 'Blocked-by-Mode', why: `${c.ied} is in ${d.mode} and the command is not a test command` }
    const pos = ieds[c.ied].seenPos
    if (stage === 'select') return pos === ctlTarget(op) ? { cause: 'Position-reached', why: `${c.breaker} is already ${DBPOS_TEXT[pos]}` } : null
    const sub = cfg.subscriptions.find(s => s.ied === c.ied && s.use === 'breakerPos')
    const s = sub && subs[sub.id]
    if (!s || s.status !== 'healthy') return { cause: 'Blocked-by-interlocking', why: `${c.ied} has no valid position of ${c.breaker}: its Position GOOSE subscription is in alarm (${s?.reason ?? 'not configured'}), so the interlocking cannot release` }
    if (op === 'close' && ieds[c.ied].trip) return { cause: 'Blocked-by-interlocking', why: `${c.ied}'s trip is still active` }
    if (!['on', 'off'].includes(pos)) return { cause: 'Blocked-by-interlocking', why: `${c.breaker} position is ${DBPOS_TEXT[pos] ?? pos}` }
    return null
  }
  function ctlStart(c, op, t) {
    const rcb = rcbs.find(r => r.id === c.rcb)
    const s = ctl[c.ied]
    s.op = op
    if (rcbSt[rcb.id].assoc !== 'up') {
      ctlEnd(c, t, 'failed', 'no association', `Operator: ${op} ${c.breaker}. ${rcb.client} cannot send it: no association with ${c.ied}`)
      return
    }
    s.phase = 'selecting'
    log(t, 'ctl', `Operator: ${op} ${c.breaker}. ${rcb.client} sends Select with value (SBOw, ${op}) to ${c.ied} CSWI1`, rcb.client, { ied: c.ied })
    ctlSend(c, 'Select', t, ta => {
      const tr = ta + serverS
      q.push(tr, () => {
        const bad = ctlCheck(c, op, 'select')
        if (bad) {
          ctlSend(c, 'Select−', tr, tg => ctlEnd(c, tg, 'failed', bad.cause, `${rcb.client}: Select refused by ${c.ied} (${bad.cause}): ${bad.why}. Nothing operated`), { cause: bad.cause })
          return
        }
        s.phase = 'selected'
        log(tr, 'ctl', `${c.ied}: CSWI1 selected for ${op}, waiting for Operate`, c.ied)
        ctlSend(c, 'Select+', tr, tg => {
          const to = tg + (M.operatorS ?? 0.2)
          log(tg, 'ctl', `${rcb.client}: Select confirmed by ${c.ied}. The operator confirms the ${op}`, rcb.client, { ied: c.ied })
          q.push(to, () => {
            if (ctl[c.ied].phase !== 'selected') return
            log(to, 'ctl', `${rcb.client} sends Operate (${op}) to ${c.ied}`, rcb.client, { ied: c.ied })
            ctlSend(c, 'Operate', to, ta2 => ctlOperate(c, op, ta2))
          })
        })
      })
    })
  }
  function ctlOperate(c, op, t) {
    const rcb = rcbs.find(r => r.id === c.rcb)
    const tr = t + serverS
    q.push(tr, () => {
      const bad = ctlCheck(c, op, 'operate')
      if (bad) {
        log(tr, 'ctlRefused', `${c.ied}: Operate refused (${bad.cause}): ${bad.why}`, c.ied)
        ctl[c.ied].phase = 'refused'
        ctlSend(c, 'Operate−', tr, tg => ctlEnd(c, tg, 'failed', bad.cause, `${rcb.client}: Operate refused by ${c.ied} (${bad.cause}). ${c.breaker} not operated`), { cause: bad.cause })
        return
      }
      ctl[c.ied].phase = 'operating'
      const sig = op === 'close' ? 'clsCmd' : 'opnCmd'
      ieds[c.ied][sig] = true
      log(tr, 'ctl', `${c.ied}: interlocking released, Operate accepted. ${op === 'close' ? 'Close' : 'Open'} command to ${c.breaker} over GOOSE (CSWI1.${op === 'close' ? 'OpCls' : 'OpOpn'})`, c.ied)
      dataChanged(c.ied, sig, tr)
      ctlSend(c, 'Operate+', tr, tg => log(tg, 'ctl', `${rcb.client}: Operate accepted by ${c.ied}, waiting for the breaker`, rcb.client, { ied: c.ied }))
      const tl = tr + (M.operTimeoutS ?? 1)
      q.push(tl, () => {
        if (ctl[c.ied].phase !== 'operating') return
        ctl[c.ied].phase = 'timeout'
        for (const sg of ['opnCmd', 'clsCmd']) if (ieds[c.ied][sg]) { ieds[c.ied][sg] = false; dataChanged(c.ied, sg, tl) }
        log(tl, 'ctlRefused', `${c.ied}: ${c.breaker} did not reach ${DBPOS_TEXT[ctlTarget(op)]} within ${M.operTimeoutS ?? 1} s: command ended (Time-limit-over)`, c.ied)
        ctlSend(c, 'CmdTerm−', tl, tg => ctlEnd(c, tg, 'failed', 'Time-limit-over', `${rcb.client}: command termination from ${c.ied}: the ${op} of ${c.breaker} failed (Time-limit-over)`), { cause: 'Time-limit-over' })
      })
    })
  }
  // The relay's CSWI watches the position it commanded
  function ctlPosSeen(relay, pos, t) {
    const c = ctls.find(x => x.ied === relay)
    const s = c && ctl[relay]
    if (!s || s.phase !== 'operating' || pos !== ctlTarget(s.op)) return
    s.phase = 'ending'
    for (const sg of ['opnCmd', 'clsCmd']) if (ieds[relay][sg]) { ieds[relay][sg] = false; dataChanged(relay, sg, t) }
    const rcb = rcbs.find(r => r.id === c.rcb)
    const te = t + serverS
    q.push(te, () => ctlSend(c, 'CmdTerm+', te, tg => ctlEnd(c, tg, 'done', null, `${rcb.client}: command termination from ${c.ied}: ${c.breaker} ${DBPOS_TEXT[pos]}, the ${s.op} is complete`)))
  }

  // The station bus path changes only at network cut times
  const mmsCutTimes = [...new Set(netCuts)].filter(t => t >= WARM_T).sort((a, b) => a - b)
  for (const rcb of rcbs) {
    const m = rcbSt[rcb.id]
    if (!m.everUp) {
      // Never connected: try again when the path appears
      m.assoc = 'lost'
    }
    for (const t of mmsCutTimes) q.push(t, () => {
      const tr = mmsTransit(rcb, t + 1e-9)
      if (tr === null && m.downSince === null) {
        m.downSince = t
        if (m.assoc === 'up') {
          const d = t
          q.push(t + M.assocTimeoutS, () => { if (m.downSince === d && m.assoc === 'up') assocLost(rcb, d + M.assocTimeoutS) })
        }
      } else if (tr !== null && m.downSince !== null) {
        m.downSince = null
        if (m.assoc === 'up') {
          for (const r of m.queued) q.push(t + tr, () => deliver(rcb, r, t + tr))
          m.queued = []
          for (const p of m.pend) q.push(t + tr, () => p.go(t + tr))
          m.pend = []
          syncMms(rcb)
        } else if (m.assoc === 'lost') {
          m.assoc = 'connecting'
          syncMms(rcb)
          const tc = t + M.reconnectS
          q.push(tc, () => (m.downSince === null ? reconnect(rcb, tc) : (m.assoc = 'lost', syncMms(rcb))))
        }
      }
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
  for (const id of danps.filter(k => !nodeOf[k].frames)) for (const lan of ['A', 'B']) {
    const due = WARM_T + lifeCheck
    q.push(due, () => { if (lastSeen[id][lan] === WARM_T && prp[id][lan] === 'ok') prp[id][lan] = 'lost' })
  }
  // Station-bus nodes: every node sends a PRP supervision frame on each LAN every
  // life-check interval; a LAN with no supervision frame from any peer alarms
  const frameNodes = danps.filter(k => nodeOf[k].frames)
  const heardOn = (k, lan, t) => frameNodes.some(k2 => {
    if (k2 === k) return false
    const n2 = nodeOf[k2]
    const r = forward(topo, cfg, scenario, { pub: n2.dev, gocb: 'PRP', dst: '01-15-4E-00-01-00', vlan: { id: portVlan(n2.dev, n2.port), priority: 0 }, length: 70, pdu: { stNum: 0, sqNum: 0 }, port: n2.port }, t)
    return r.arrivals.some(a => a.ied === nodeOf[k].dev && lanOf(a.via) === lan)
  })
  for (const k of frameNodes) for (const lan of ['A', 'B']) {
    for (const t of [WARM_T, ...mmsCutTimes]) q.push(t, () => {
      const h = heardOn(k, lan, t + 1e-9)
      if (h && prp[k][lan] !== 'ok') {
        prp[k][lan] = 'ok'
        log(t, 'prpOk', `${nodeName(k)}: supervision frames on LAN ${lan} again`, nodeOf[k].dev, { lan, net: 'station' })
      } else if (!h && prp[k][lan] === 'ok') {
        const due = t + lifeCheck
        q.push(due, () => {
          if (prp[k][lan] === 'ok' && !heardOn(k, lan, due)) {
            prp[k][lan] = 'lost'
            log(due, 'prpLan', `${nodeName(k)}: no PRP supervision frame on LAN ${lan} for ${lifeCheck * 1000} ms. PRP alarm: still connected over LAN ${lan === 'A' ? 'B' : 'A'}, but no longer redundant`, nodeOf[k].dev, { lan, net: 'station' })
          }
        })
      }
    })
  }
  q.push(START_T, () => {
    log(START_T, 'start', 'Quiet period: each publisher sends a heartbeat every second', null)
    for (const id of danps) for (const lan of ['A', 'B']) {
      if (prp[id][lan] === 'lost') log(START_T, 'prpLan', `${nodeName(id)}: PRP alarm standing: nothing received on LAN ${lan}`, nodeOf[id].dev, { lan, ...(nodeOf[id].frames ? { net: 'station' } : {}) })
    }
    for (const rcb of rcbs) if (rcbSt[rcb.id].assoc !== 'up') log(START_T, 'mmsLost', `${rcb.client}: no association with ${rcb.ied} (standing): SCADA has no data from it. Alarm`, rcb.client, { rcb: rcb.id, ied: rcb.ied })
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
  // RSTP: a standby ring link takes over once the recovery time has passed
  for (const l of cfg.links.filter(x => x.rstp === 'standby')) {
    const d = scenario.linkDown[l.backs]
    if (d === undefined || d === null) continue
    const rec = (cfg.network.rstpRecoveryMs ?? 50) / 1000
    if (d >= START_T) q.push(d, () => log(d, 'rstp', `RSTP: ${l.backs} lost, the ring reconfigures; frames across it are lost until ${l.id} forwards`, null))
    if (d + rec >= START_T) q.push(d + rec, () => log(d + rec, 'rstp', `RSTP: ${l.id} unblocked and forwarding, ${rec * 1000} ms after ${l.backs} failed. The network has recovered`, null))
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
  // SV supervision events: lost / frozen after the detection time, invalid at once
  const lossS = (T.svLossMs ?? 1) / 1000
  for (const sub of cfg.svSubs ?? []) {
    const cb = cfg.svcbs.find(x => x.id === sub.sv)
    let prev = { status: 'healthy', synch: 2 }
    for (const h of svHealth[sub.id]) {
      const st = svStatusOf(h)
      if (st !== prev.status) {
        const at = st === 'lost' || st === 'frozen' ? h.t0 + lossS : h.t0
        q.push(at, () => {
          sv[sub.id] = { ...sv[sub.id], status: st, reason: h.reason }
          if (st === 'healthy') log(at, 'svOk', `${sub.ied}: valid samples from ${cb.ied} again`, sub.ied, { sub: sub.id })
          else log(at, 'svLost', `${sub.ied}: SV from ${cb.ied} ${st === 'lost' ? 'lost' : st}: ${h.reason}. Protection using it is blocked. Alarm`, sub.ied, { sub: sub.id })
        })
      }
      if (h.synch !== prev.synch) q.push(h.t0, () => { sv[sub.id] = { ...sv[sub.id], synch: h.synch } })
      prev = { status: st, synch: h.synch }
    }
  }
  // Sync changes, once per merging unit, naming who blocks and who carries on
  for (const cb of cfg.svcbs ?? []) {
    const subsCb = (cfg.svSubs ?? []).filter(s => s.sv === cb.id)
    if (!subsCb.length) continue
    const comparing = subsCb.filter(s => (cfg.svSubs ?? []).filter(x => x.ied === s.ied).length > 1).map(s => s.ied)
    const single = subsCb.map(s => s.ied).filter(id => !comparing.includes(id))
    let prevSync = 2
    for (const h of svHealth[subsCb[0].id]) {
      if (h.synch === prevSync) continue
      const was = prevSync
      prevSync = h.synch
      if (h.t0 < START_T && h.synch !== 0) continue
      q.push(Math.max(h.t0, START_T), () => {
        const t = Math.max(h.t0, START_T)
        if (h.synch === 0) log(t, 'svSync', `${cb.ied} lost time sync: smpSynch 0${h.t0 < START_T ? ' (standing)' : ''}.${comparing.length ? ` ${comparing.join(', ')} ${comparing.length > 1 ? 'compare' : 'compares'} merging units and ${comparing.length > 1 ? 'block' : 'blocks'}.` : ''}${single.length ? ` ${single.join(', ')} ${single.length > 1 ? 'use' : 'uses'} one merging unit and ${single.length > 1 ? 'carry' : 'carries'} on.` : ''} Alarm`, cb.ied)
        else log(t, 'svSyncOk', `${cb.ied}: smpSynch ${h.synch} (${h.synch === 2 ? 'global clock' : 'local clock only'})${was === 0 ? ', synchronized again' : ''}`, cb.ied)
      })
    }
  }
  // PTP: grandmaster events and state
  if (ptp) {
    for (const t of ptp.cuts) q.push(t, () => { ptpNow = ptp.gmAt(t + 1e-9) })
    for (const e of ptp.events) if (e.t >= START_T) q.push(e.t, () => { ptpNow = ptp.gmAt(e.t + 1e-9); log(e.t, 'ptp', e.text, e.dev ?? null) })
  }
  q.push(START_T, () => {
    for (const sub of cfg.svSubs ?? []) {
      if (sv[sub.id].status !== 'healthy') log(START_T, 'svLost', `${sub.ied}: SV alarm standing: ${sv[sub.id].reason}`, sub.ied, { sub: sub.id })
    }
    if (ptpNow) for (const [g, s] of Object.entries(ptpNow.states)) if (s !== 'locked') log(START_T, 'ptp', `${g} standing: ${s === 'degraded' ? 'GPS lost long ago, past its holdover spec: local time only' : s === 'holdover' ? 'GPS lost: holdover' : s}`, g)
  })

  const faultLine = cfg.script?.faultLine ?? 'AB'
  // The breakers of the faulted zone's relays (a line or transformer bay has one)
  const faultBkrs = () => cfg.ieds.filter(d => d.kind === 'relay' && (d.protects ?? d.line ?? d.bay) === faultLine)
    .map(r => cfg.ieds.find(d => d.kind === 'breaker' && d.bay === r.bay)?.id).filter(Boolean)
  const cmd = scenario.control
  const cmdCtl = cmd && ctls.find(c => c.ied === cmd.ied)
  if (cmdCtl && OP[cmd.op]) q.push(cmd.at ?? 0.5, () => ctlStart(cmdCtl, cmd.op, cmd.at ?? 0.5))
  const FAULT_NAME = { BUSA: 'bus A', XFMRAT: 'transformer A–T' }
  q.push(0, () => { fault = true; log(0, 'fault', `Fault on ${FAULT_NAME[faultLine] ?? `line ${faultLine[0]}–${faultLine[1]}`}`, null) })
  for (const r of cfg.ieds.filter(d => d.kind === 'relay' && (d.protects ?? d.line ?? d.bay) === faultLine)) {
    const t0trip = T.relayTripCycles / f
    let tt = t0trip
    // A relay measuring from SV needs a cycle of good samples after the fault
    const svSubsR = (cfg.svSubs ?? []).filter(s => s.ied === r.id)
    if (svSubsR.length) {
      // One combined health timeline over every stream this relay uses. A relay
      // comparing several merging units also needs them on the same kind of clock.
      const segAt = (segs, t) => segs.find(h => t >= h.t0 && t < h.t1) ?? segs.at(-1)
      const cuts = [...new Set(svSubsR.flatMap(s => svHealth[s.id].map(h => h.t0)))].sort((a, b) => a - b)
      const comb = cuts.map((t0, i) => {
        const hs = svSubsR.map(s => ({ h: segAt(svHealth[s.id], t0), mu: cfg.svcbs.find(x => x.id === s.sv).ied }))
        const badOne = hs.find(x => !svGood(x.h))
        const synchs = new Set(hs.map(x => x.h.synch))
        const syncBad = hs.length > 1 && (synchs.size > 1 || synchs.has(0))
        return { t0, t1: cuts[i + 1] ?? Infinity, good: !badOne && !syncBad,
          reason: badOne ? `${badOne.mu}: ${badOne.h.reason}` : syncBad ? `merging units not on a common clock (smpSynch ${hs.map(x => `${x.mu} ${x.h.synch}`).join(', ')})` : null }
      })
      tt = null
      for (const h of comb.filter(x => x.good)) {
        if (h.t1 <= 0) continue
        const cand = h.t0 <= 0 ? t0trip : Math.max(t0trip, h.t0 + 1 / f)
        if (cand < h.t1) { tt = cand; break }
      }
      if (tt === null) {
        const bad = comb.find(h => h.t0 <= t0trip && h.t1 > t0trip) ?? comb.at(-1)
        const fn = r.protects === 'BUSA' ? 'bus differential' : r.protects === 'XFMRAT' ? 'transformer differential' : 'distance protection'
        q.push(t0trip, () => log(t0trip, 'noTrip', `${r.id} cannot use its samples (${bad.reason ?? 'stream not usable'}): ${fn} blocked, the fault is not seen`, r.id))
        continue
      }
    }
    const late = tt > t0trip + 1e-9
    q.push(tt, () => {
      ieds[r.id].trip = true
      log(tt, 'trip', `${r.id} trips (PTRC Tr.general = true)${late ? ', one cycle after valid samples returned' : ''}`, r.id)
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
  mmsNotes(cfg, events, reports, outcome)
  ctlNotes(cfg, events, ctlMsgs, outcome)
  return { events, frames: shown, outcome, startT: START_T, endT: END_T, config: cfg, profile: prof, svHealth, reports: reports.filter(r => r.tSent >= START_T - EPS), controls: ctlMsgs }
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
  const relay = cfg.ieds.find(d => d.kind === 'relay' && (d.protects ?? d.line ?? d.bay) === faultLine)
  // The breakers this relay's trip message opens; a line or transformer relay has one, the bus differential several
  const tripBkrs = cfg.subscriptions.filter(s => s.use === 'tripCoil' && cfg.gocbs.find(g => g.id === s.gocb && g.ied === relay?.id && g.entries.some(e => e.signal === 'trip'))).map(s => s.ied)
  if (relay && tripBkrs.length > 1) return judgeMulti(cfg, events, frames, relay, tripBkrs)
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

  if (!tripEv && relay) {
    out.verdict = 'noTrip'
    const nt = events.find(e => e.kind === 'noTrip' && e.dev === relay.id)
    const zone = { XFMRAT: 'The transformer’s', BUSA: 'Bus A’s' }[relay.protects] ?? `Line ${faultLine[0]}–${faultLine[1]}’s`
    notes.push({ level: 'bad', text: `${relay.id} did not trip: ${nt ? nt.text.replace(`${relay.id} cannot use`, 'it could not use') : 'no trip'}. ${zone} own protection never acted; backup protection elsewhere has to clear the fault, later and taking out more (the Line Protection Simulator shows that part).` })
  } else if (tripEv && tripEv.t > (cfg.timing.relayTripCycles / f) + 1e-9) {
    notes.push({ level: 'warn', text: `${relay.id} tripped at ${fmtProt(tripEv.t, f)} instead of ${fmtProt(cfg.timing.relayTripCycles / f, f)}: it needed a cycle of valid samples after they returned.` })
    if (openEv && ['delivered', 'late'].includes(out.verdict)) out.verdict = 'clearedLate'
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
  for (const e of events.filter(x => x.kind === 'svLost' || (x.kind === 'svSync' && /lost/.test(x.text)))) {
    const when = e.t <= START_T + 1e-9 ? 'standing since before the run' : `at ${fmtTime(e.t)}`
    notes.push({ level: 'warn', text: `${e.kind === 'svSync' ? 'Time-sync' : 'SV'} alarm, ${e.dev}: ${when}.` })
  }
  for (const e of events.filter(x => x.kind === 'ptp')) notes.push({ level: 'info', text: `Time sync, ${fmtTime(e.t)}: ${e.text}.` })
  const prpAlarms = events.filter(e => e.kind === 'prpLan' && e.net !== 'station')
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
  const silent = ['notDelivered', 'notCleared'].includes(out.verdict) && tripSub && !events.some(e => e.sub === tripSub.id && ['alarm', 'stale', 'mismatch'].includes(e.kind))
  const why = bkr?.lphdSim ? `: ${tripSub.ied}'s subscription stayed healthy, fed by the test set. Only ${bkr.id}'s simulation mode, on its display and the HMI, showed it`
    : relay?.mode !== 'on' ? `: ${tripSub.ied}'s subscription stayed healthy. Only ${relay.id}'s mode, on its display and the HMI, showed it` : ''
  if (silent && !stuckEv) notes.push({ level: 'bad', text: `No alarm warned of it${why}.` })
  return out
}

// What SCADA learned about the trip, over MMS
function mmsNotes(cfg, events, reports, out) {
  if (!(cfg.rcbs ?? []).length || !out.relay) return
  const tripEv = events.find(e => e.kind === 'trip' && e.dev === out.relay)
  const rcb = cfg.rcbs.find(r => r.ied === out.relay)
  const notes = out.notes
  for (const e of events.filter(x => x.kind === 'mmsLost')) {
    const when = e.t <= START_T + 1e-9 ? 'standing since before the run' : `at ${fmtTime(e.t)}`
    notes.push({ level: 'warn', text: `Alarm, ${e.dev}: association with ${e.ied} lost, ${when}.` })
  }
  for (const e of events.filter(x => x.kind === 'prpLan' && x.net === 'station')) {
    const text = `PRP alarm, ${e.dev} on the station bus: LAN ${e.lan} silent, ${e.t <= START_T + 1e-9 ? 'standing since before the run' : `at ${fmtTime(e.t)}`}.`
    if (!notes.some(n => n.text === text)) notes.push({ level: 'warn', text })
  }
  if (!tripEv || !rcb) return
  const rep = reports.find(r => r.ied === out.relay && r.signal === 'trip' && r.value === true && r.tEvent >= tripEv.t - 1e-9)
  out.scadaT = rep?.tRx ?? null
  if (!rep) return
  if (rep.fate === 'onTime') notes.push({ level: 'info', text: `SCADA: ${out.relay}'s trip reported at ${fmtTime(rep.tRx)}, ${fmtDur(rep.tRx - tripEv.t)} after the trip (MMS report). Protection never waits for it.` })
  else if (rep.fate === 'tcp' && rep.tRx !== null) notes.push({ level: 'warn', text: `SCADA: ${out.relay}'s trip reached the gateway at ${fmtTime(rep.tRx)}, by TCP retransmission once the station bus was back: ${fmtDur(rep.tRx - tripEv.t)} late, with its original time stamp.` })
  else if (rep.fate === 'buffer' && rep.tRx !== null) notes.push({ level: 'warn', text: `SCADA: ${out.relay}'s trip reached the gateway at ${fmtTime(rep.tRx)}, from the buffered report after the association came back: late, but with its original time stamp (${fmtTime(rep.tEvent)}). Nothing lost.` })
  else if (rep.fate === 'lost') notes.push({ level: 'bad', text: `SCADA never received ${out.relay}'s trip: ${rep.reason}. The general interrogation after reconnecting shows only the state now, so the trip is missing from SCADA's event list.` })
  else notes.push({ level: 'warn', text: `SCADA had not received ${out.relay}'s trip by the end of the run: ${rep.fate === 'buffer' ? 'it waits in the report buffer for the association to return' : 'TCP is still retransmitting'}.` })
}

// The operator's command, over MMS (feature controls)
function ctlNotes(cfg, events, msgs, out) {
  const start = events.find(e => e.kind === 'ctl' && e.text.startsWith('Operator:')) ?? events.find(e => e.kind === 'ctlFail' && e.text.startsWith('Operator:'))
  if (!start) return
  const end = events.find(e => (e.kind === 'ctlDone' || e.kind === 'ctlFail') && e.t >= start.t)
  const what = start.text.split('. ')[0].replace('Operator: ', '')
  out.ctl = { what, t0: start.t, tEnd: end?.t ?? null, ok: end?.kind === 'ctlDone' }
  if (!end) out.notes.push({ level: 'warn', text: `Operator command (${what}): no result by the end of the run.` })
  else if (end.kind === 'ctlDone') out.notes.push({ level: 'info', text: `Operator command (${what}): selected, operated and confirmed by command termination at ${fmtTime(end.t)}, ${fmtDur(end.t - start.t)} after the operator's select.` })
  else out.notes.push({ level: 'warn', text: `Operator command (${what}) failed at ${fmtTime(end.t)}: ${end.text.replace(/^[^:]+: /, '')}.` })
}

// Outcome for a relay that trips several breakers (bus differential)
function judgeMulti(cfg, events, frames, relay, bkrs) {
  const f = cfg.freqHz
  const notes = []
  const tripEv = events.find(e => e.kind === 'trip' && e.dev === relay.id)
  const after = (kind, dev) => events.find(e => e.kind === kind && e.dev === dev && tripEv && e.t >= tripEv.t)
  const per = bkrs.map(b => ({ dev: b, coil: after('coil', b)?.t ?? null, t: after('open', b)?.t ?? null }))
  const coils = per.map(p => p.coil).filter(x => x !== null)
  const out = { multi: true, tripT: tripEv?.t ?? null, coilT: coils.length ? Math.min(...coils) : null, openT: null, bfT: null, clearT: null, bfOpens: per.map(p => ({ dev: p.dev, t: p.t })),
    classMs: TRIP_CLASS.ms, className: TRIP_CLASS.name, freqHz: f, notes, relay: relay.id, breaker: bkrs.join(', ') }
  if (!tripEv) {
    out.verdict = 'noTrip'
    const nt = events.find(e => e.kind === 'noTrip' && e.dev === relay.id)
    notes.push({ level: 'bad', text: `${relay.id} did not trip: ${nt ? nt.text.replace(`${relay.id} cannot use`, 'it could not use') : 'no trip'}. Nothing at bus A clears the fault; remote backup at the far ends of every line has to (much later, and it takes out more).` })
  } else {
    const worst = Math.max(...per.map(p => (p.coil ?? Infinity) - tripEv.t))
    out.transferT = Number.isFinite(worst) ? worst : undefined
    const missing = per.filter(p => p.t === null).map(p => p.dev)
    notes.push({ level: 'info', text: `One trip message from ${relay.id}, ${bkrs.length} subscribers: ${bkrs.join(', ')}.` })
    const t0trip = cfg.timing.relayTripCycles / f
    if (tripEv.t > t0trip + 1e-9) notes.push({ level: 'warn', text: `${relay.id} tripped at ${fmtProt(tripEv.t, f)} instead of ${fmtProt(t0trip, f)}: it needed a cycle of usable samples after they returned.` })
    if (!missing.length) {
      out.openT = Math.max(...per.map(p => p.t))
      out.clearT = out.openT
      const inClass = worst * 1000 <= TRIP_CLASS.ms + 1e-9
      out.verdict = tripEv.t > t0trip + 1e-9 ? 'clearedLate' : inClass ? 'delivered' : 'late'
      notes.push({ level: inClass ? 'info' : 'warn', text: `Slowest transfer time ${fmtDur(worst)}: ${inClass ? 'inside' : 'beyond'} the ${TRIP_CLASS.ms} ms class. Bus A cleared at ${fmtProt(out.openT, f)}.` })
    } else {
      out.verdict = 'notCleared'
      const sub = cfg.subscriptions.find(s => s.ied === missing[0] && cfg.gocbs.find(g => g.id === s.gocb)?.ied === relay.id)
      const fr = frames.find(x => x.gocb === sub?.gocb && x.sendT >= tripEv.t)
      const why = fr?.rx[sub.id]?.reason
      notes.push({ level: 'bad', text: `${missing.join(', ')} did not open${why ? ` (${why})` : ''}: bus A is not cleared. Remote backup has to clear the rest.` })
    }
  }
  for (const e of events.filter(x => ['alarm', 'stale', 'mismatch', 'svLost'].includes(x.kind) || (x.kind === 'svSync' && /lost/.test(x.text)))) {
    const when = e.t <= START_T + 1e-9 ? 'standing since before the run' : `at ${fmtTime(e.t)}`
    const text = `Alarm, ${e.dev}: ${e.text.split('. ')[0].replace(`${e.dev}: `, '').replace(`${e.dev} `, '')}, ${when}.`
    if (!notes.some(n => n.text === text)) notes.push({ level: 'warn', text })
  }
  for (const e of events.filter(x => x.kind === 'ptp')) notes.push({ level: 'info', text: `Time sync, ${fmtTime(e.t)}: ${e.text}.` })
  return out
}

export function stateAt(events, t) {
  let idx = 0
  for (let i = 0; i < events.length; i++) if (events[i].t <= t + EPS) idx = i
  return { idx, state: events[idx].state }
}

export { fmtAppid }
