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

// With test mode on, a test set sits on a spare process-bus port, ready to
// publish simulated messages (scenario.testSet).
function addTestSet(c) {
  c.ieds.push({ id: 'TS', kind: 'testset', name: 'TestSet', label: 'Test set', mac: '02-00-00-00-00-77', mode: 'on', lphdSim: false, simulates: true })
  c.switches.find(s => s.id === 'PB').ports[9] = { vlans: [10] }
  c.links.push({ id: 'L9', a: 'TS', b: 'PB:9' })
  return c
}

export function stationConfig(config) {
  if (!isActive(config, 'secondBay')) return isActive(config, 'testMode') ? addTestSet(structuredClone(config)) : config
  const c = structuredClone(config)
  c.ieds.push(
    { id: '21-AX', kind: 'relay', bay: 'AX', line: 'AX', name: 'LineProtAX', label: 'Line relay', mac: '02-00-00-AE-00-21', mode: 'on', lphdSim: false },
    { id: '52-AX', kind: 'breaker', bay: 'AX', name: 'BkrCtlAX', label: 'Breaker IED', mac: '02-00-00-AE-00-52', mode: 'on', lphdSim: false },
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
