// Injected failures. A scenario is separate from the config so a failure never
// leaks into settings or into lessons that don't set it.
//
//   linkDown:   { [linkId]: t }          link down from time t (s); -Infinity = whole run
//   drops:      [{ link, gocb, st, sq }] drop one specific frame on one link
//   subWrong:   { [subId]: field }       a subscription engineered wrong:
//                                         'appid' | 'gocbRef' | 'datSet' | 'confRev'
//   vlanMissing: [{ sw, port, vlan }]    a switch port that doesn't carry a VLAN

export const EMPTY_SCENARIO = { linkDown: {}, drops: [], subWrong: {}, vlanMissing: [] }

export const normalizeScenario = sc => ({ ...EMPTY_SCENARIO, ...(sc ?? {}) })

export const SUB_WRONG = {
  appid: { label: 'Wrong APPID', short: 'APPID' },
  gocbRef: { label: 'Wrong gocbRef (copied from bay A–X)', short: 'gocbRef' },
  datSet: { label: 'Wrong dataset name', short: 'datSet' },
  confRev: { label: 'Publisher re-issued (confRev 2), subscriber not updated', short: 'confRev' },
}

// Fixed choices for a link, instead of a free time setting
export const LINK_PRESETS = [
  { id: 'up', label: 'In service', t: null },
  { id: 'always', label: 'Down for the whole run', t: -Infinity },
  { id: 'quiet', label: 'Fails 2 s before the fault', t: -2.0 },
  { id: 'fault', label: 'Fails at the fault', t: 0 },
]

export function countFailures(sc) {
  const s = normalizeScenario(sc)
  return Object.keys(s.linkDown).length + s.drops.length + Object.keys(s.subWrong).length + s.vlanMissing.length
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
  for (const { sw, port, vlan } of s.vlanMissing) {
    const p = cfg.switches.find(x => x.id === sw)?.ports[port]
    if (p) p.vlans = p.vlans.filter(v => v !== vlan)
  }
  return cfg
}
