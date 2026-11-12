// The station the engine runs, built from the config and the feature toggles.
// Default: one bay (line A–B) on the station bus and the process bus. With the
// secondBay feature: line A–X on the same bus A, on the same two networks, and
// breaker failure (50BF) published by each line relay to the other bay's
// breaker IED (SPEC § 9, slice 2). Pure: returns a new config.

import { isActive } from './features'

const gocb = (id, ied, label, iedName, ld, cb, ds, goID, mac, appid, entries, port) => ({
  id, ied, label, ...(port ? { port } : {}),
  gocbRef: `${iedName}${ld}/LLN0$GO$${cb}`, datSet: `${iedName}${ld}/LLN0$${ds}`, goID,
  mac, appid, vlan: { id: 10, priority: 4 }, confRev: 1, entries,
})
const subOf = (id, ied, g, use) => ({
  id, ied, gocb: g.id, use,
  expect: { mac: g.mac, appid: g.appid, gocbRef: g.gocbRef, datSet: g.datSet, confRev: g.confRev },
})
const bfEntries = [
  { ref: 'PROT/RBRF1.OpEx.general', type: 'BOOLEAN', signal: 'bf' },
  { ref: 'PROT/RBRF1.OpEx.q', type: 'Quality', signal: 'bf' },
]

// With redundancy on, the process bus becomes two independent networks (PRP,
// IEC 62439-3): LAN A (PBA) and LAN B (PBB). Every device with a process-bus
// port gets one on each (relay port P → P.A and P.B; breaker IED → A and B,
// same MAC on both, as PRP does). The test set stays single-attached (LAN A).
function applyPRP(c) {
  const pb = c.switches.find(s => s.id === 'PB')
  c.switches = c.switches.filter(s => s.id !== 'PB')
  c.switches.push(
    { ...structuredClone(pb), id: 'PBA', label: 'Process bus, LAN A', lan: 'A' },
    { ...structuredClone(pb), id: 'PBB', label: 'Process bus, LAN B', lan: 'B' },
  )
  const out = []
  for (const l of c.links) {
    const [a, b] = [l.a, l.b]
    const pbEnd = [a, b].find(e => e.startsWith('PB:'))
    if (!pbEnd) { out.push(l); continue }
    const other = pbEnd === a ? b : a
    const port = pbEnd.split(':')[1]
    if (other.startsWith('TS')) { out.push({ ...l, a: other, b: `PBA:${port}` }); continue }
    for (const lan of ['A', 'B']) {
      const end = other.includes(':') ? `${other}.${lan}` : `${other}:${lan}`
      out.push({ id: `${l.id}${lan}`, a: end, b: `PB${lan}:${port}` })
    }
  }
  c.links = out
  return c
}

// RSTP: the process bus as two switches in a ring, PB1 (relays, test set) and
// PB2 (breaker IEDs), joined by R1 (forwarding) and R2 (blocked by spanning
// tree until R1 fails and the recovery time has passed).
function applyRSTP(c) {
  const pb = c.switches.find(s => s.id === 'PB')
  c.switches = c.switches.filter(s => s.id !== 'PB')
  const kindOf = id => c.ieds.find(d => d.id === id)?.kind
  const sideOf = end => (['breaker', 'mu'].includes(kindOf(end.split(':')[0].split('.')[0])) ? 'PB2' : 'PB1')
  const ports = { PB1: { 7: { vlans: [10] }, 8: { vlans: [10] } }, PB2: { 7: { vlans: [10] }, 8: { vlans: [10] } } }
  c.links = c.links.map(l => {
    const pbEnd = [l.a, l.b].find(e => e.startsWith('PB:'))
    if (!pbEnd) return l
    const other = pbEnd === l.a ? l.b : l.a
    const port = pbEnd.split(':')[1]
    const sw = sideOf(other)
    ports[sw][port] = structuredClone(pb.ports[port])
    return { ...l, a: other, b: `${sw}:${port}` }
  })
  c.switches.push(
    { id: 'PB1', label: 'Process bus, ring switch 1', ports: ports.PB1 },
    { id: 'PB2', label: 'Process bus, ring switch 2', ports: ports.PB2 },
  )
  c.links.push(
    { id: 'R1', a: 'PB1:8', b: 'PB2:8', rstp: 'active' },
    { id: 'R2', a: 'PB1:7', b: 'PB2:7', rstp: 'standby', backs: 'R1' },
  )
  return c
}

// With test mode on, a test set sits on a spare process-bus port, ready to
// publish simulated messages (scenario.testSet).
function addTestSet(c) {
  c.ieds.push({ id: 'TS', kind: 'testset', name: 'TestSet', label: 'Test set', mac: '02-00-00-00-00-77', mode: 'on', lphdSim: false, simulates: true })
  c.switches.find(s => s.id === 'PB').ports[9] = { vlans: [10] }
  c.links.push({ id: 'L9', a: 'TS', b: 'PB:9' })
  return c
}

// Sampled Values: a merging unit in each line bay on the process bus, publishing
// the bay's CT and VT samples; the line relay subscribes instead of being wired.
function addMergingUnits(c) {
  const pb = c.switches.find(s => s.id === 'PB')
  c.svcbs = []
  c.svSubs = []
  // One merging unit per bay with a breaker (its bus-side CTs and VTs), plus the
  // transformer's LV side
  const units = c.ieds.filter(d => d.kind === 'breaker').map(d => ({ bay: d.bay, id: `MU-${d.bay}`, hex: d.bay === 'AB' ? 'AB' : d.bay === 'AX' ? 'AE' : 'A7' }))
  if (c.ieds.some(d => d.id === '87-AT')) units.push({ bay: 'AT', id: 'MU-ATL', hex: 'A8', lv: true })
  units.forEach((u, i) => {
    const n = i + 1, port = 5 + i
    c.ieds.push({ id: u.id, kind: 'mu', bay: u.bay, name: `MergingUnit${u.id.slice(3)}`, label: u.lv ? 'LV side' : 'Merging unit', mac: `02-00-00-${u.hex}-00-4D`, mode: 'on', lphdSim: false })
    pb.ports[port] = { vlans: [10] }
    c.links.push({ id: `M${n}`, a: u.id, b: `PB:${port}` })
    c.svcbs.push({
      id: `${u.id.slice(3)}.SV`, ied: u.id, label: 'SV', svID: `MU_${u.id.slice(3)}_SV`,
      msvRef: `MergingUnit${u.id.slice(3)}MU/LLN0$MS$SV`, datSet: `MergingUnit${u.id.slice(3)}MU/LLN0$PhsMeas1`,
      mac: `01-0C-CD-04-00-0${n}`, appid: 0x4000 + n, vlan: { id: 10, priority: 4 }, confRev: 1,
      smpPerCycle: 80, noASDU: 1, length: 123,
    })
  })
  // Who measures from which stream
  for (const r of c.ieds.filter(d => d.kind === 'relay')) {
    const uses = r.id === '87B-A' ? ['AB', 'AX', 'AT'] : r.id === '87-AT' ? ['AT', 'ATL'] : [r.bay]
    for (const u of uses) {
      if (!c.svcbs.some(x => x.id === `${u}.SV`)) continue
      c.svSubs.push({ id: uses.length > 1 ? `${r.id}.SV-${u}` : `${r.id}.SV`, ied: r.id, sv: `${u}.SV`, use: 'measure' })
    }
  }
  return c
}

// Transformer tap A–T behind feeder breaker 52-AT, with transformer
// differential 87-AT, and bus differential 87B-A for bus A (SPEC § 2.1)
function addTransformerBay(c) {
  const pb = c.switches.find(s => s.id === 'PB'), sb = c.switches.find(s => s.id === 'SB')
  c.ieds.push(
    { id: '87-AT', kind: 'relay', bay: 'AT', protects: 'XFMRAT', name: 'XfmrProtAT', label: 'Transformer diff.', mac: '02-00-00-A7-00-87', mode: 'on', lphdSim: false },
    { id: '52-AT', kind: 'breaker', bay: 'AT', name: 'BkrCtlAT', label: 'Breaker IED (PIU)', mac: '02-00-00-A7-00-52', mode: 'on', lphdSim: false },
    { id: '87B-A', kind: 'relay', bay: 'BUS', protects: 'BUSA', name: 'BusProtA', label: 'Bus differential', mac: '02-00-00-BA-00-87', mode: 'on', lphdSim: false },
  )
  for (const p of [10, 11, 12]) pb.ports[p] = { vlans: [10] }
  for (const p of [4, 5]) sb.ports[p] = { vlans: [20] }
  c.links.push(
    { id: 'T1', a: '87-AT:P', b: 'PB:10' },
    { id: 'T2', a: 'PB:11', b: '52-AT' },
    { id: 'T3', a: '87-AT:S', b: 'SB:4' },
    { id: 'B1', a: '87B-A:P', b: 'PB:12' },
    { id: 'B2', a: '87B-A:S', b: 'SB:5' },
  )
  const tripE = [{ ref: 'PROT/PTRC1.Tr.general', type: 'BOOLEAN', signal: 'trip' }, { ref: 'PROT/PTRC1.Tr.q', type: 'Quality', signal: 'trip' }]
  const posE = [{ ref: 'CTRL/XCBR1.Pos.stVal', type: 'Dbpos', signal: 'pos' }, { ref: 'CTRL/XCBR1.Pos.q', type: 'Quality', signal: 'pos' }]
  const atTrip = gocb('AT.Trip', '87-AT', 'Trip', 'XfmrProtAT', 'PROT', 'Trip', 'DS_Trip', 'AT_Trip', '01-0C-CD-01-00-21', 0x0301, tripE, 'P')
  const atPos = gocb('AT.Pos', '52-AT', 'Position', 'BkrCtlAT', 'CTRL', 'Pos', 'DS_Pos', 'AT_Pos', '01-0C-CD-01-00-22', 0x0302, posE)
  const busTrip = gocb('BUS.Trip', '87B-A', 'Trip', 'BusProtA', 'PROT', 'Trip', 'DS_Trip', 'BUS_Trip', '01-0C-CD-01-00-31', 0x0401, tripE, 'P')
  c.gocbs.push(atTrip, atPos, busTrip)
  c.subscriptions.push(
    subOf('52-AT.Trip', '52-AT', atTrip, 'tripCoil'),
    subOf('87-AT.Pos', '87-AT', atPos, 'breakerPos'),
    ...['52-AB', '52-AX', '52-AT'].map(b => subOf(`${b}.BUS`, b, busTrip, 'tripCoil')),
  )
  // Breaker failure in a line bay also trips the transformer feeder (bus A cleared)
  for (const g of c.gocbs.filter(x => x.entries.some(e => e.signal === 'bf'))) c.subscriptions.push(subOf(`52-AT.BF-${g.ied.slice(-2)}`, '52-AT', g, 'tripCoil'))
  return c
}

export function stationConfig(config0) {
  // The transformer bay brings the second bay and Sampled Values with it; without
  // it, a fault set on the bus or the transformer falls back to line A–B
  const config = isActive(config0, 'transformerBay')
    ? { ...config0, features: { ...config0.features, secondBay: true, sampledValues: true } }
    : ['BUSA', 'XFMRAT'].includes(config0.script?.faultLine) ? { ...config0, script: { ...config0.script, faultLine: 'AB' } } : config0
  let base = buildStation(config)
  if (isActive(config, 'transformerBay')) base = addTransformerBay(base === config ? structuredClone(config) : base)
  if (isActive(config, 'sampledValues')) base = addMergingUnits(base === config ? structuredClone(config) : base)
  if (!isActive(config, 'redundancy')) return base
  const c = base === config ? structuredClone(config) : base
  return config.network?.redundancy === 'rstp' ? applyRSTP(c) : applyPRP(c)
}

function buildStation(config) {
  if (!isActive(config, 'secondBay')) return isActive(config, 'testMode') ? addTestSet(structuredClone(config)) : config
  const c = structuredClone(config)
  c.ieds.push(
    { id: '21-AX', kind: 'relay', bay: 'AX', line: 'AX', name: 'LineProtAX', label: 'Line relay', mac: '02-00-00-AE-00-21', mode: 'on', lphdSim: false },
    { id: '52-AX', kind: 'breaker', bay: 'AX', name: 'BkrCtlAX', label: 'Breaker IED (PIU)', mac: '02-00-00-AE-00-52', mode: 'on', lphdSim: false },
  )
  // Breaker failure in both line relays
  for (const r of c.ieds.filter(d => d.kind === 'relay')) r.bf = true
  const pb = c.switches.find(s => s.id === 'PB'), sb = c.switches.find(s => s.id === 'SB')
  pb.ports[3] = { vlans: [10] }
  pb.ports[4] = { vlans: [10] }
  sb.ports[3] = { vlans: [20] }
  c.links.push(
    { id: 'L5', a: '21-AX:P', b: 'PB:3' },
    { id: 'L6', a: 'PB:4', b: '52-AX' },
    { id: 'L7', a: '21-AX:S', b: 'SB:3' },
  )
  const abBF = gocb('AB.BF', '21-AB', 'BF trip', 'LineProtAB', 'PROT', 'BFTrip', 'DS_BF', 'AB_BF', '01-0C-CD-01-00-03', 0x0103, bfEntries, 'P')
  const axTrip = gocb('AX.Trip', '21-AX', 'Trip', 'LineProtAX', 'PROT', 'Trip', 'DS_Trip', 'AX_Trip', '01-0C-CD-01-00-11', 0x0201, [
    { ref: 'PROT/PTRC1.Tr.general', type: 'BOOLEAN', signal: 'trip' },
    { ref: 'PROT/PTRC1.Tr.q', type: 'Quality', signal: 'trip' },
  ], 'P')
  const axPos = gocb('AX.Pos', '52-AX', 'Position', 'BkrCtlAX', 'CTRL', 'Pos', 'DS_Pos', 'AX_Pos', '01-0C-CD-01-00-12', 0x0202, [
    { ref: 'CTRL/XCBR1.Pos.stVal', type: 'Dbpos', signal: 'pos' },
    { ref: 'CTRL/XCBR1.Pos.q', type: 'Quality', signal: 'pos' },
  ])
  const axBF = gocb('AX.BF', '21-AX', 'BF trip', 'LineProtAX', 'PROT', 'BFTrip', 'DS_BF', 'AX_BF', '01-0C-CD-01-00-13', 0x0203, bfEntries, 'P')
  c.gocbs.push(abBF, axTrip, axPos, axBF)
  c.subscriptions.push(
    subOf('52-AX.Trip', '52-AX', axTrip, 'tripCoil'),
    subOf('21-AX.Pos', '21-AX', axPos, 'breakerPos'),
    subOf('52-AX.BF-AB', '52-AX', abBF, 'tripCoil'),
    subOf('52-AB.BF-AX', '52-AB', axBF, 'tripCoil'),
  )
  return isActive(config, 'testMode') ? addTestSet(c) : c
}
