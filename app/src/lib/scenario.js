// Injected failures. A scenario is separate from the config so a failure never
// leaks into settings or into lessons that don't set it.
//
//   linkDown:   { [linkId]: t }          link down from time t (s); -Infinity = whole run
//   linkUp:     { [linkId]: t }          a failed link back in service at t (s)
//   drops:      [{ link, gocb, st, sq }] drop one specific frame on one link
//   subWrong:   { [subId]: field }       a subscription engineered wrong:
//                                         'appid' | 'gocbRef' | 'datSet' | 'confRev'
//   vlanMissing: [{ sw, port, vlan }]    a switch port that doesn't carry a VLAN
//   iedMode:    { [iedId]: mode }         'test' | 'test/blocked' (feature testMode)
//   breakerStuck: [iedId]                 trip coil energized, mechanism doesn't move
//   switchDown: { [switchId]: t }         switch fails at t (s); -Infinity = whole run
//   switchUp:   { [switchId]: t }         a failed switch back in service at t (s)
//   subMissing: [subId]                   a subscription never configured at all
//   testSet:    { imitate: gocbId, tripAt } test set publishing simulated copies (feature testMode)
//   simMode:    [iedId]                   IEDs in simulation mode (LPHD.Sim)
//   svFault:    { [svId]: { kind, at } }  merging-unit problem: stop | freeze | invalid | sync
//   gm:         { [gmId]: { gpsLostAt, failAt } } grandmaster problems (feature timeSync)
//   rcbUnbuffered: [rcbId]                a report engineered unbuffered (URCB) instead of buffered (feature mms)

export const EMPTY_SCENARIO = { linkDown: {}, drops: [], subWrong: {}, vlanMissing: [], iedMode: {}, breakerStuck: [], switchDown: {}, subMissing: [], testSet: null, simMode: [], svFault: {}, gm: {}, linkUp: {}, switchUp: {}, rcbUnbuffered: [] }

export const normalizeScenario = sc => ({ ...EMPTY_SCENARIO, ...(sc ?? {}) })

export const SUB_WRONG = {
  appid: { label: 'Wrong APPID', short: 'APPID' },
  gocbRef: { label: 'Wrong gocbRef (copied from bay A–X)', short: 'gocbRef' },
  datSet: { label: 'Wrong dataset name', short: 'datSet' },
  confRev: { label: 'Publisher re-issued (confRev 2), subscriber not updated', short: 'confRev' },
}

// IED modes the UI offers (Mod/Beh; IEC 61850-7-4 Annex A)
export const IED_MODES = [
  { id: 'on', label: 'On (normal)' },
  { id: 'test', label: 'Test' },
  { id: 'test/blocked', label: 'Test/blocked' },
]

// Fixed choices for a link or switch, instead of a free time setting
export const LINK_PRESETS = [
  { id: 'up', label: 'In service', t: null },
  { id: 'always', label: 'Down for the whole run', t: -Infinity },
  { id: 'quiet', label: 'Fails 2 s before the fault', t: -2.0 },
  { id: 'fault', label: 'Fails at the fault', t: 0 },
  { id: 'outage', label: 'Out for 1.5 s from the fault', t: 0, upAt: 1.5 },
]
// The preset a link's scenario entries correspond to
export const linkPresetOf = (down, up) =>
  LINK_PRESETS.find(p => (p.t === null ? down === undefined : p.t === down && (p.upAt ?? undefined) === up))?.id ?? 'up'

export function countFailures(sc) {
  const s = normalizeScenario(sc)
  return Object.keys(s.linkDown).length + s.drops.length + Object.keys(s.subWrong).length + s.vlanMissing.length +
    Object.keys(s.iedMode).length + s.breakerStuck.length + Object.keys(s.switchDown).length + s.subMissing.length +
    (s.testSet ? 1 : 0) + s.simMode.length + Object.keys(s.svFault).length + s.rcbUnbuffered.length +
    Object.values(s.gm).filter(g => Number.isFinite(g?.gpsLostAt) || Number.isFinite(g?.failAt)).length
}

// Apply engineering errors (subscriptions, VLAN membership) to a copy of the
// config. Link failures and drops are applied by the network as frames pass.
export function applyScenario(config, sc) {
  const s = normalizeScenario(sc)
  const cfg = structuredClone(config)
  for (const [subId, field] of Object.entries(s.subWrong)) {
    const sub = cfg.subscriptions.find(x => x.id === subId)
    if (!sub) continue
    const g = cfg.gocbs.find(x => x.id === sub.gocb)
    if (field === 'appid') sub.expect.appid = g.appid + 0x10
    if (field === 'gocbRef') sub.expect.gocbRef = sub.expect.gocbRef.replace(/AB/g, 'AX')
    if (field === 'datSet') sub.expect.datSet = sub.expect.datSet + 'All'
    if (field === 'confRev') g.confRev = sub.expect.confRev + 1 // dataset edited and the publisher reloaded
  }
  cfg.subscriptions = cfg.subscriptions.filter(x => !s.subMissing.includes(x.id))
  for (const id of s.simMode) {
    const d = cfg.ieds.find(x => x.id === id)
    if (d) d.lphdSim = true
  }
  for (const [id, mode] of Object.entries(s.iedMode)) {
    const d = cfg.ieds.find(x => x.id === id)
    if (d) d.mode = mode
  }
  for (const id of s.rcbUnbuffered) {
    const r = (cfg.rcbs ?? []).find(x => x.id === id)
    if (r) { r.buffered = false; r.rptID = r.rptID.replace('$BR$', '$RP$') }
  }
  for (const { sw, port, vlan } of s.vlanMissing) {
    const p = cfg.switches.find(x => x.id === sw)?.ports[port]
    if (p) p.vlans = p.vlans.filter(v => v !== vlan)
  }
  return cfg
}
