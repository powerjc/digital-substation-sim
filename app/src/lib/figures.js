// Pure helpers for the Foundations figures. The switch figures run the real
// network model (network.js) on a tiny four-device topology, so Foundations
// and the simulator can't disagree.

import { buildTopo, forward, serializationS, isGroupMac, BROADCAST } from './network'
import { simulate } from './timeline'
import { defaultConfig, PROFILES } from './schema'
import { applyScenario } from './scenario'
import { buildFrame, datasetValues, matchFrame, sequenceCheck, testDecision, fmtAppid } from './goose'

export const GOOSE_MAC = '01-0C-CD-01-00-01'

export const DEMO_DEVICES = [
  { id: 'D1', label: 'Line relay', role: 'sends', mac: '02-00-00-00-00-01', listens: [] },
  { id: 'D2', label: 'Breaker IED', role: 'subscribes to the trip', mac: '02-00-00-00-00-02', listens: [GOOSE_MAC] },
  { id: 'D3', label: 'Gateway', role: 'not subscribed', mac: '02-00-00-00-00-03', listens: [] },
  { id: 'D4', label: 'Fault recorder', role: 'subscribes to the trip', mac: '02-00-00-00-00-04', listens: [GOOSE_MAC] },
]

export const SEND_KINDS = {
  unicast: { label: 'Unicast to the gateway', dst: '02-00-00-00-00-03' },
  broadcast: { label: 'Broadcast', dst: BROADCAST },
  multicast: { label: 'Multicast (GOOSE trip)', dst: GOOSE_MAC },
}

// Four devices on one switch, port n ↔ device Dn. vlan10: which of ports 2–4
// carry VLAN 10 (the sender's port always does). filter: multicast filtering,
// with ports 2 and 4 registered for the trip group.
export function demoConfig({ filter = false, vlan10 = { 2: true, 3: true, 4: true } } = {}) {
  const ports = {}
  for (const n of [1, 2, 3, 4]) {
    ports[n] = { vlans: n === 1 || vlan10[n] ? [10] : [20], groups: n === 2 || n === 4 ? [GOOSE_MAC] : [] }
  }
  return {
    ieds: DEMO_DEVICES.map(d => ({ id: d.id, mac: d.mac })),
    switches: [{ id: 'SW', ports, mcastFilter: filter }],
    links: DEMO_DEVICES.map((d, i) => ({ id: `P${i + 1}`, a: d.id, b: `SW:${i + 1}` })),
    network: { linkMbps: 100, switchLatencyUs: 5 },
  }
}

// Send one frame from D1. → { devices: { [id]: { arrived, kept, why } }, hops }
export function demoSend(kind, opts = {}) {
  const cfg = demoConfig(opts)
  const topo = buildTopo(cfg)
  const frame = { pub: 'D1', gocb: 'demo', dst: SEND_KINDS[kind].dst, vlan: { id: 10, priority: 4 }, length: 140, pdu: { stNum: 1, sqNum: 0 } }
  const r = forward(topo, cfg, {}, frame, 0)
  const devices = {}
  for (const d of DEMO_DEVICES.slice(1)) {
    const arrived = r.arrivals.some(a => a.ied === d.id)
    const loss = r.losses.find(l => l.ied === d.id)
    let kept = false, why
    if (!arrived) why = loss?.kind === 'vlan' ? 'port not in VLAN 10' : 'not sent this way'
    else if (frame.dst === d.mac) { kept = true; why = 'its own address' }
    else if (frame.dst === BROADCAST) { kept = true; why = 'broadcast: everyone keeps it' }
    else if (isGroupMac(frame.dst) && d.listens.includes(frame.dst)) { kept = true; why = 'subscribed to this group' }
    else why = isGroupMac(frame.dst) ? 'not subscribed: discards it' : 'not its address: discards it'
    devices[d.id] = { arrived, kept, why }
  }
  return { devices, hops: r.hops }
}

// Priority queueing at a busy egress port: a trip frame arrives while
// `queued` full-size frames wait (one of them already being sent).
export const FULL_FRAME_BYTES = 1518
export function queueWait({ queued = 10, priority = false, mbps = 100 } = {}) {
  const one = serializationS(FULL_FRAME_BYTES, mbps)
  return priority ? one : queued * one // worst case: the frame in progress can't be interrupted
}

// The simulator's first trip frame, for the frame anatomy figure
export function sampleTripFrame() {
  const r = simulate(defaultConfig(), {})
  return r.frames.find(f => f.gocb === 'AB.Trip' && f.sendT > 0)
}

// ── Part B ──

// B1: the three kinds of message
export const MESSAGE_KINDS = [
  { id: 'mms', name: 'MMS', replaces: 'The RTU: SCADA polls, reports, controls', pattern: 'Client/server: ask and answer', who: 'Gateway, HMI ↔ each IED', rate: 'On request, or a report when values change', speed: 'About a second is fine', layer: 'TCP/IP: routable', color: '#7c3aed' },
  { id: 'goose', name: 'GOOSE', replaces: 'Trip, block and status wiring', pattern: 'Publish/subscribe, repeated', who: 'IED → any IEDs that subscribe', rate: 'On every change, then a heartbeat', speed: 'A few milliseconds (trips: 3 ms class)', layer: 'Ethernet only: Layer 2', color: '#2563eb' },
  { id: 'sv', name: 'Sampled Values', replaces: 'CT and VT secondary wiring', pattern: 'Publish/subscribe, continuous stream', who: 'Merging unit → protection IEDs', rate: '80 samples per cycle: 4800 per second at 60 Hz', speed: 'Every sample, all the time', layer: 'Ethernet only: Layer 2', color: '#16a34a' },
]
export const SV_SAMPLES_PER_CYCLE = 80

// B2: take a full reference apart
export function parseReference(iedName, ref) {
  const [ldFull, rest] = ref.split('/')
  const ld = ldFull.startsWith(iedName) ? ldFull.slice(iedName.length) : ldFull
  const [ln, ...attrs] = rest.split('.')
  const m = ln.match(/^(.*?)([A-Z]{4})(\d*)$/)
  return [
    { kind: 'ied', text: iedName },
    { kind: 'ld', text: ld },
    { kind: 'sep', text: '/' },
    ...(m[1] ? [{ kind: 'prefix', text: m[1] }] : []),
    { kind: 'lnClass', text: m[2] },
    { kind: 'lnInst', text: m[3] },
    ...attrs.flatMap((a, i) => [{ kind: 'sep', text: '.' }, { kind: i === 0 ? 'do' : 'da', text: a }]),
  ]
}

export const LN_TABLE = [
  { dev: '21', fn: 'Distance', ln: 'PDIS' },
  { dev: '50 / 51', fn: 'Overcurrent, instantaneous / time', ln: 'PIOC / PTOC' },
  { dev: '87', fn: 'Differential (line, bus, transformer)', ln: 'PDIF' },
  { dev: '27 / 59', fn: 'Under / overvoltage', ln: 'PTUV / PTOV' },
  { dev: '81', fn: 'Under / overfrequency', ln: 'PTUF / PTOF' },
  { dev: '50BF', fn: 'Breaker failure', ln: 'RBRF' },
  { dev: '79', fn: 'Reclosing', ln: 'RREC' },
  { dev: '25', fn: 'Synchronism check', ln: 'RSYN' },
  { dev: '94', fn: 'Trip output (trip conditioning)', ln: 'PTRC' },
  { dev: '52', fn: 'Circuit breaker', ln: 'XCBR' },
  { dev: '89', fn: 'Disconnect switch', ln: 'XSWI' },
  { dev: '—', fn: 'Breaker / switch control', ln: 'CSWI' },
  { dev: 'CT / VT', fn: 'Current / voltage transformer', ln: 'TCTR / TVTR' },
]

// B4: the publishing pattern, from the same profile the simulator uses.
// changes: times (s) at which the value changes; returns frames up to untilS.
export function publishSchedule({ changes = [0], untilS = 0.07, profile = PROFILES.typical } = {}) {
  const frames = []
  const cs = [...changes].sort((a, b) => a - b)
  cs.forEach((c, k) => {
    const stop = k + 1 < cs.length ? cs[k + 1] : Infinity
    let t = c, i = 0, sq = 0
    while (t < stop - 1e-12 && t <= untilS + 1e-12) {
      const next = i < profile.intervalsMs.length ? profile.intervalsMs[i] : profile.heartbeatMs
      frames.push({ t, st: k + 2, sq, tal: profile.talFactor * next })
      t += next / 1000
      i++
      sq++
    }
  })
  return frames
}

// B5: one frame through a subscriber's checks
export const SUB_CASES = [
  { id: 'new', label: 'A new state arrives' },
  { id: 'repeat', label: 'A repeat arrives' },
  { id: 'appid', label: 'Wrong APPID in the subscription' },
  { id: 'gocbRef', label: 'Wrong gocbRef in the subscription' },
  { id: 'confRev', label: 'Dataset edited (confRev 2), subscriber not updated' },
  { id: 'test', label: 'Publisher in test mode' },
  { id: 'silence', label: 'Nothing arrives' },
]

export function subscribePipeline(caseId) {
  const base = defaultConfig()
  const wrong = ['appid', 'gocbRef', 'confRev'].includes(caseId) ? { subWrong: { '52-AB.Trip': caseId } } : {}
  const cfg = applyScenario(base, wrong)
  const sub = cfg.subscriptions.find(s => s.id === '52-AB.Trip')
  const g = cfg.gocbs.find(x => x.id === sub.gocb)
  const pubIed = { ...cfg.ieds.find(d => d.id === g.ied), mode: caseId === 'test' ? 'test' : 'on' }
  const subIed = cfg.ieds.find(d => d.id === sub.ied)
  const sq = caseId === 'repeat' ? 1 : 0
  const frame = buildFrame({ id: 0, gocb: g, ied: pubIed, sendT: 0.0177, changeT: 0.0167, stNum: 2, sqNum: sq, tal: sq ? 8 : 4,
    allData: datasetValues(g, { trip: true }, pubIed) })
  const subState = caseId === 'repeat' ? { lastSt: 2, lastSq: 0 } : { lastSt: 1, lastSq: 5 }
  const steps = [
    { id: 'filter', label: '1. Is it for me?', sub: 'destination address, APPID' },
    { id: 'identity', label: '2. Is it the message I was configured for?', sub: 'gocbRef, dataset, confRev' },
    { id: 'sequence', label: '3. Is it new?', sub: 'stNum, sqNum' },
    { id: 'test', label: '4. Can I use it?', sub: 'quality, test flag' },
    { id: 'supervision', label: '5. Supervision', sub: 'restart the TAL timer' },
  ]
  const res = {}
  let outcome
  if (caseId === 'silence') {
    for (const s of steps.slice(0, 4)) res[s.id] = { result: 'skip', detail: 'no frame' }
    res.supervision = { result: 'fail', detail: 'TAL of the last frame (2000 ms on a heartbeat) runs out with nothing new' }
    outcome = { level: 'bad', text: 'Message lost: values marked invalid, alarm raised. Nothing else is acted on.' }
    return { frame: null, sub, steps: steps.map(s => ({ ...s, ...res[s.id] })), outcome }
  }
  const m = matchFrame(frame, sub)
  const stop = (from, why) => { for (const s of steps.slice(from)) res[s.id] = { result: 'skip', detail: why } }
  if (m.fate === 'ignored') {
    res.filter = { result: 'fail', detail: m.compare.map(c => `${c.field}: expects ${c.expected}, frame has ${c.received}`).join('; ') }
    stop(1, 'dropped at step 1')
    outcome = { level: 'bad', text: 'Dropped quietly: not one of mine. The subscription only ever sees “no message”.' }
  } else {
    res.filter = { result: 'pass', detail: `${frame.dst}, APPID ${fmtAppid(frame.appid)}` }
    if (m.fate === 'rejected') {
      res.identity = { result: 'fail', detail: m.compare.map(c => `${c.field}: expects ${c.expected}, frame has ${c.received}`).join('; ') }
      stop(2, 'rejected at step 2')
      outcome = { level: 'bad', text: 'Rejected, and reported as a configuration mismatch: the alarm says what is wrong.' }
    } else {
      res.identity = { result: 'pass', detail: `${frame.pdu.gocbRef}, confRev ${frame.pdu.confRev}` }
      const seq = sequenceCheck(subState, frame)
      res.sequence = { result: 'pass', detail: seq.kind === 'new' ? `stNum ${frame.pdu.stNum} after ${subState.lastSt}: new state` : `stNum ${frame.pdu.stNum} again, sqNum ${frame.pdu.sqNum}: a repeat` }
      const dataTest = frame.pdu.allData.some(d => d.type === 'Quality' && d.value.test)
      const th = testDecision(dataTest, subIed.mode)
      res.test = th.use ? { result: 'pass', detail: dataTest ? th.note : 'quality good, no test flag' } : { result: 'fail', detail: th.note }
      res.supervision = { result: 'pass', detail: `timer restarted: next frame due within ${frame.pdu.timeAllowedtoLive} ms` }
      outcome = !th.use ? { level: 'warn', text: 'Accepted for supervision, but the trip is not used: test data in a normal-mode IED. This is how a relay under test stays isolated.' }
        : seq.kind === 'new' ? { level: 'good', text: 'Acted on: trip = true goes to the breaker IED’s logic, which energizes the trip coil.' }
        : { level: 'info', text: 'Nothing to do: the state is already known. The repeat only proves the publisher is still there.' }
    }
  }
  return { frame, sub, steps: steps.map(s => ({ ...s, ...res[s.id] })), outcome }
}

// B6: who uses test data
export const TEST_MATRIX = [false, true].map(dataTest => ({
  dataTest,
  cells: ['on', 'test'].map(mode => ({ mode, ...testDecision(dataTest, mode) })),
}))

// ── Part C: virtual wiring ──

// C3: 52a / 52b → double-point position (IEC 61850-7-3 Dbpos)
export function posFromAux(a52Closed, b52Closed) {
  if (a52Closed && !b52Closed) return 'on'
  if (!a52Closed && b52Closed) return 'off'
  if (!a52Closed && !b52Closed) return 'intermediate'
  return 'bad'
}
// What the contacts really are for each breaker state (true = contact closed)
export const AUX_STATE = {
  closed: { a: true, b: false },
  moving: { a: false, b: false },
  open: { a: false, b: true },
}
// The IED reads a contact as closed only if its wire is intact
export function readAux(breaker, { b52WireBroken = false } = {}) {
  const s = AUX_STATE[breaker]
  const a = s.a, b = s.b && !b52WireBroken
  return { a, b, pos: posFromAux(a, b) }
}

// C2: one trip to several destinations, copper vs digital
export const FANOUT_DESTS = [
  { id: 'tc1', name: '52 trip coil 1', supervised: true },
  { id: 'tc2', name: '52 trip coil 2', supervised: true },
  { id: 'bfi', name: '50BF initiate', supervised: false },
  { id: 'dfr', name: 'Fault recorder', supervised: false },
  { id: 'scada', name: 'SCADA alarm', supervised: false },
]
export const AUX_CONTACTS = 4 // contacts on one 94 auxiliary tripping relay (illustrative)

// fail: 'none' | 'common' (aux relay coil / publisher) | 'one' (path to destination 3)
export function fanout({ model, n = 4, fail = 'none' }) {
  const dests = FANOUT_DESTS.slice(0, n).map((d, i) => {
    const hit = fail === 'common' || (fail === 'one' && i === 2)
    // Copper: only supervised circuits (trip coils: TCS) alarm, and only for wiring,
    // not for a dead aux relay coil. Digital: every subscriber supervises its feed.
    const alarmed = hit && (model === 'digital' || (fail === 'one' && d.supervised))
    return { ...d, delivered: !hit, alarmed }
  })
  const extra = model === 'copper' && n > AUX_CONTACTS
    ? `No spare contact: a second aux relay and new wiring for destination ${n}.`
    : model === 'digital' && n > AUX_CONTACTS ? `Destination ${n}: a new subscription in that IED. The publisher is unchanged.` : null
  return { dests, extra }
}

// C4: a lockout, as an 86 relay and as IED logic
export function lockoutStep(state, action, { retained = true, model = 'digital' } = {}) {
  const s = { ...state }
  let note
  if (action === 'trip') { s.lo = true; s.closed = false; note = 'Lockout set: breaker tripped.' }
  if (action === 'close') {
    if (s.lo) note = 'Close blocked: lockout is set.'
    else { s.closed = true; note = 'Breaker closed.' }
  }
  if (action === 'reset') { note = s.lo ? 'Lockout reset by hand.' : 'Nothing to reset.'; s.lo = false }
  if (action === 'restart') {
    if (model === 'copper') note = 'No effect: the 86 is mechanically latched.'
    else if (retained) note = 'IED restarts; the latch was stored, lockout still set.'
    else { note = s.lo ? 'IED restarts and forgets: lockout lost, closing no longer blocked.' : 'IED restarts.'; s.lo = false }
  }
  return { ...s, note }
}

// C5: the signal matrix for the end-goal station (SPEC § 2.1)
export const MATRIX_IEDS = ['21-AB', '52-AB', '21-AX', '52-AX', '87-AT', '52-AT']
export const SIGNAL_MATRIX = [
  { id: 'AB.Trip', signal: 'Line A–B trip', pub: '21-AB', subs: { '52-AB': 'Trips breaker 52-AB.' } },
  { id: 'AB.BF', signal: 'Breaker failure, 52-AB', pub: '21-AB', subs: { '52-AX': 'Clears bus A: trips the other breakers on the bus.', '52-AT': 'Clears bus A: trips the other breakers on the bus.' } },
  { id: 'AX.Trip', signal: 'Line A–X trip', pub: '21-AX', subs: { '52-AX': 'Trips breaker 52-AX.' } },
  { id: 'AX.BF', signal: 'Breaker failure, 52-AX', pub: '21-AX', subs: { '52-AB': 'Clears bus A.', '52-AT': 'Clears bus A.' } },
  { id: 'AT.Trip', signal: 'Transformer trip (87T), lockout', pub: '87-AT', subs: { '52-AT': 'Trips 52-AT and blocks closing until the lockout is reset.' } },
  { id: 'AB.Pos', signal: '52-AB position', pub: '52-AB', subs: { '21-AB': 'Breaker status for the relay’s logic (breaker failure, reclosing).' } },
  { id: 'AX.Pos', signal: '52-AX position', pub: '52-AX', subs: { '21-AX': 'Breaker status for the relay’s logic.' } },
  { id: 'AT.Pos', signal: '52-AT position', pub: '52-AT', subs: { '87-AT': 'Breaker status for the transformer relay’s logic.' } },
]
// Virtual inputs of one IED, in matrix order
export const virtualInputs = ied => SIGNAL_MATRIX.filter(r => r.subs[ied]).map((r, i) => ({ vi: `VI${i + 1}`, signal: r.signal, from: r.pub, use: r.subs[ied] }))

// ── Part D: configuration ──

const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0')
const lnRef = ref => { // 'PROT/PTRC1.Tr.general' → parts
  const [ld, rest] = ref.split('/')
  const [ln, doName, daName] = rest.split('.')
  const m = ln.match(/^([A-Z]{4})(\d*)$/)
  return { ld, lnClass: m[1], lnInst: m[2], doName, daName }
}

export const SCL_FILES = [
  { id: 'ssd', name: 'SSD', full: 'System Specification Description', from: 'Utility / designer', to: 'System configurator',
    what: 'The single line and the functions it needs, as data: bays, breakers, and which logical nodes each needs, not yet given to any IED.', like: 'The one-line and the protection philosophy.' },
  { id: 'icd', name: 'ICD', full: 'IED Capability Description', from: 'IED vendor', to: 'System configurator',
    what: 'What one IED type can do: its logical devices, logical nodes and data, as a template.', like: 'The relay’s instruction manual and ordering code.' },
  { id: 'scd', name: 'SCD', full: 'Substation Configuration Description', from: 'System configurator', to: 'IED configurators',
    what: 'The whole substation: every IED, every network address, every dataset and control block, and every subscription.', like: 'The complete set of schematics and wiring diagrams.' },
  { id: 'cid', name: 'CID', full: 'Configured IED Description', from: 'IED configurator', to: 'The IED',
    what: 'The part of the SCD one IED needs, plus its own settings, ready to load.', like: 'The relay’s settings file.' },
  { id: 'iid', name: 'IID', full: 'Instantiated IED Description', from: 'IED configurator', to: 'System configurator',
    what: 'One configured IED sent back to the system tool after changes in the IED tool (Edition 2).', like: 'A marked-up drawing returned for the master set.' },
  { id: 'sed', name: 'SED', full: 'System Exchange Description', from: 'One project', to: 'Another project',
    what: 'The part of one substation’s configuration another project needs, e.g. the remote end of a line (Edition 2).', like: 'Interface drawings exchanged between two stations.' },
]

export function sclExcerpt(id, config = defaultConfig()) {
  const prof = PROFILES[config.goose.profile] ?? PROFILES.typical
  const g = config.gocbs.find(x => x.id === 'AB.Trip')
  const pub = config.ieds.find(d => d.id === g.ied)
  const sub = config.subscriptions.find(s => s.gocb === g.id)
  const subIed = config.ieds.find(d => d.id === sub.ied)
  const ld = g.entries[0].ref.split('/')[0]
  const cb = g.gocbRef.split('$').pop()
  const ds = g.datSet.split('$').pop()
  const fcda = g.entries.map(e => { const r = lnRef(e.ref); return `      <FCDA ldInst="${r.ld}" lnClass="${r.lnClass}" lnInst="${r.lnInst}" doName="${r.doName}" daName="${r.daName}" fc="ST"/>` }).join('\n')
  const gse = `<GSE ldInst="${ld}" cbName="${cb}">
  <Address>
    <P type="MAC-Address">${g.mac}</P>
    <P type="APPID">${hex(g.appid, 4)}</P>
    <P type="VLAN-ID">${hex(g.vlan.id, 3)}</P>
    <P type="VLAN-PRIORITY">${g.vlan.priority}</P>
  </Address>
  <MinTime unit="s" multiplier="m">${prof.intervalsMs[0]}</MinTime>
  <MaxTime unit="s" multiplier="m">${prof.heartbeatMs}</MaxTime>
</GSE>`
  const ied = `<IED name="${pub.name}">  <!-- … -->
  <LDevice inst="${ld}">
    <LN0 lnClass="LLN0" inst="">
      <DataSet name="${ds}">
${fcda}
      </DataSet>
      <GSEControl name="${cb}" datSet="${ds}" appID="${g.goID}" confRev="${g.confRev}" type="GOOSE"/>
    </LN0>`
  const t = lnRef(g.entries[0].ref)
  const extref = `<IED name="${subIed.name}">  <!-- the subscriber -->
  <LN0 lnClass="LLN0" inst="">
    <Inputs>
      <ExtRef iedName="${pub.name}" ldInst="${t.ld}" lnClass="${t.lnClass}" lnInst="${t.lnInst}"
              doName="${t.doName}" daName="${t.daName}" serviceType="GOOSE"
              srcLDInst="${ld}" srcCBName="${cb}" intAddr="TripIn1"/>
    </Inputs>`
  const ind = (s, n) => s.split('\n').map(l => ' '.repeat(n) + l).join('\n')
  return {
    ssd: `<Substation name="StationA">
  <VoltageLevel name="HV">
    <Bay name="AB">
      <ConductingEquipment name="52" type="CBR">
        <LNode lnClass="XCBR" lnInst="1" iedName="None"/>
      </ConductingEquipment>
      <Function name="LineProtection">
        <LNode lnClass="PDIS" lnInst="1" iedName="None"/>
        <LNode lnClass="PTRC" lnInst="1" iedName="None"/>
      </Function>
    </Bay>`,
    icd: `<IED name="TEMPLATE" type="LineRelay">
  <AccessPoint name="AP1"><Server>
    <LDevice inst="PROT">
      <LN0 lnClass="LLN0" inst="" lnType="LLN0_1"/>
      <LN lnClass="PDIS" inst="1" lnType="PDIS_1"/>
      <LN lnClass="PTRC" inst="1" lnType="PTRC_1"/>
    </LDevice>
  </Server></AccessPoint>
</IED>
<DataTypeTemplates>  <!-- what each lnType contains --> …`,
    scd: `<Communication><SubNetwork name="Bus_AB">
  <ConnectedAP iedName="${pub.name}" apName="AP1">
${ind(gse, 4)}
  </ConnectedAP> …
</SubNetwork></Communication>
${ied}
…
${extref}`,
    cid: `<!-- only what ${pub.name} needs, ready to load -->
<Communication> … <ConnectedAP iedName="${pub.name}"> ${'<GSE …/>'} … </Communication>
${ied}`,
    iid: `<!-- ${pub.name} after changes in its IED tool, back to the system tool -->
${ied}`,
    sed: `<!-- for the project at station B: what it needs of station A -->
<IED name="${pub.name}"> … <GSEControl name="${cb}" …/> … </IED>`,
  }[id]
}

// D2: where each value on the simulator screen is set
export const WHERE_LIVES = [
  { value: 'Destination MAC, APPID, VLAN ID, priority', where: 'SCD, Communication section: the control block’s GSE address. Copied into the publisher’s and the subscriber’s CID.', miss: 'appid' },
  { value: 'gocbRef', where: 'Built from the IED name, logical device and control block name in the SCD’s IED section.', miss: 'gocbRef' },
  { value: 'Dataset and its entries', where: 'DataSet and its FCDA entries in the publisher’s LLN0.', miss: 'datSet' },
  { value: 'confRev', where: 'GSEControl. Goes up whenever the dataset changes.', miss: 'confRev' },
  { value: 'goID', where: 'GSEControl, in an attribute confusingly called appID (not the APPID).', miss: null },
  { value: 'Fastest repeat and heartbeat', where: 'GSE MinTime and MaxTime (the IED applies its own curve between them).', miss: null },
  { value: 'What the subscriber expects, and where it goes', where: 'ExtRef in the subscriber’s Inputs: source IED, control block, data; intAddr is the virtual input.', miss: 'gocbRef' },
  { value: 'Switch port VLANs', where: 'The switch’s own configuration, from the VLAN plan. Usually outside SCL.', miss: 'vlan' },
]

// D3: commissioning steps and the classic misses each one catches
export const COMMISSIONING_STEPS = [
  { id: 'config', label: 'Configuration check', how: 'Every IED holds the CID made from the current SCD: compare versions and confRev.' },
  { id: 'network', label: 'Network check', how: 'Switch ports and VLANs against the VLAN plan; frames seen on the right ports with a network analyzer on a mirror port.' },
  { id: 'status', label: 'Subscription status', how: 'Every subscription in every IED healthy before any functional test: no standing alarms.' },
  { id: 'functional', label: 'Signal tests in test mode', how: 'Each signal from publisher to the subscriber’s logic, with test flags so in-service IEDs ignore it (B6).' },
  { id: 'endtoend', label: 'End-to-end trip', how: 'Relay to breaker, through every link, as before.' },
  { id: 'restore', label: 'Restore', how: 'Every IED back to on, simulation off, alarm list clear.' },
]
export const MISSES = [
  { id: 'appid', label: 'Subscription with the wrong APPID', caughtBy: ['status', 'functional', 'endtoend'], scenario: { subWrong: { '52-AB.Trip': 'appid' } } },
  { id: 'gocbRef', label: 'Subscription with the wrong gocbRef', caughtBy: ['status', 'functional', 'endtoend'], scenario: { subWrong: { '52-AB.Trip': 'gocbRef' } } },
  { id: 'datSet', label: 'Subscription with the wrong dataset name', caughtBy: ['status', 'functional', 'endtoend'], scenario: { subWrong: { '52-AB.Trip': 'datSet' } } },
  { id: 'confRev', label: 'Publisher reloaded with an edited dataset, subscriber not', caughtBy: ['config', 'status', 'functional', 'endtoend'], scenario: { subWrong: { '52-AB.Trip': 'confRev' } } },
  { id: 'vlan', label: 'Switch port missing the VLAN', caughtBy: ['network', 'status', 'functional', 'endtoend'], scenario: { vlanMissing: [{ sw: 'SW1', port: 2, vlan: 10 }] } },
  { id: 'link', label: 'Bad fibre or optic', caughtBy: ['network', 'status', 'endtoend'], scenario: { linkDown: { L2: -Infinity } } },
  { id: 'testLeft', label: 'An IED left in test mode', caughtBy: ['restore'], scenario: null },
]

// ── Part E: time ──

// E1: a sequence of events stamped by two clocks
export function stampedSequence(offsetS) {
  const r = simulate(defaultConfig(), {})
  const pick = [
    { kind: 'trip', label: '21-AB trips' },
    { kind: 'coil', label: '52-AB energizes the trip coil' },
    { kind: 'open', label: '52-AB contacts part' },
    { kind: 'seen', label: '21-AB sees 52-AB open', last: true },
  ]
  const rows = pick.map(p => {
    const evs = r.events.filter(e => e.kind === p.kind)
    const e = p.last ? evs.at(-1) : evs[0]
    const own = e.dev === '52-AB'
    return { label: p.label, dev: e.dev, trueT: e.t, stampT: e.t + (own ? offsetS : 0) }
  })
  const sorted = [...rows].sort((a, b) => a.stampT - b.stampT)
  return { rows: sorted, misordered: sorted.some((x, i) => x !== rows[i]) }
}

// E2: time error is phase error
export const phaseDeg = (dtS, freqHz = 60) => 360 * freqHz * dtS
export const falseDiff = (dtS, freqHz = 60) => 2 * Math.sin((phaseDeg(dtS, freqHz) * Math.PI) / 180 / 2)
export const ILLUSTRATIVE_SLOPE = 0.3

// E3: which clock becomes grandmaster (IEEE 1588 comparison, simplified:
// priority1, then clock class, then priority2)
export const CLOCK_CLASS = { locked: 6, holdover: 7, free: 248 }
export function bestMaster(clocks) {
  const live = clocks.filter(c => !c.failed)
  if (!live.length) return null
  return [...live].sort((a, b) => a.priority1 - b.priority1 || CLOCK_CLASS[a.state] - CLOCK_CLASS[b.state] || a.priority2 - b.priority2)[0].id
}

// E4: protection and sync status (typical behaviour; vendors differ)
export const SYNC_FUNCS = [
  { id: '87B', label: '87B bus A', uses: ['AX', 'AB', 'AT'] },
  { id: '21AB', label: '21-AB line A–B', uses: ['AB'] },
  { id: '51AT', label: '51 transformer A–T', uses: ['AT'] },
]
export function protectionUnderSync(smp) {
  return SYNC_FUNCS.map(f => {
    const v = f.uses.map(m => smp[m])
    if (f.uses.length === 1) return { ...f, ok: true, why: 'one merging unit: its samples line up with each other whatever the clock' }
    if (v.includes(0)) return { ...f, ok: false, why: 'a stream is not synchronized: samples from different merging units can’t be lined up' }
    if (new Set(v).size > 1) return { ...f, ok: false, why: 'streams synchronized to different references: not provably the same clock' }
    return { ...f, ok: true, why: v[0] === 2 ? 'all on a global (GPS-traceable) clock' : 'all on the same local clock' }
  })
}

// E5: holdover, simplified as a constant frequency error (no ageing, no temperature)
export const OSCILLATORS = [
  { id: 'xo', label: 'Basic crystal', ppm: 1 },
  { id: 'ocxo', label: 'Oven-controlled crystal', ppm: 0.01 },
  { id: 'rb', label: 'Rubidium', ppm: 0.0001 },
]
export const holdoverError = (ppm, seconds) => ppm * 1e-6 * seconds
export const secondsTo = (ppm, errS) => errS / (ppm * 1e-6)
