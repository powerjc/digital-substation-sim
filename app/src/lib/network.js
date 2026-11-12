// Ethernet network: links between IEDs and switches, store-and-forward
// switches that flood multicast to the ports carrying the frame's VLAN.
// Delays are fixed and illustrative: serialization per link plus a fixed
// switch latency. Propagation (~5 ns/m) is ignored.

export const PREAMBLE_IFG_BYTES = 20 // preamble + SFD (8) + inter-frame gap (12)

// End point "PB:2" → { dev: 'PB', port: 2 }; "21-AB:P" → { dev: '21-AB', port: 'P' };
// "52-AB" → { dev: '52-AB', port: null }
export function parseEnd(s) {
  const [dev, port] = String(s).split(':')
  if (port === undefined) return { dev, port: null }
  return { dev, port: Number.isNaN(Number(port)) ? port : Number(port) }
}

export function buildTopo(config) {
  const adj = {}
  const add = (from, to, link) => {
    ;(adj[from.dev] ??= []).push({ link: link.id, port: from.port, peer: to.dev, peerPort: to.port })
  }
  for (const l of config.links) {
    const a = parseEnd(l.a), b = parseEnd(l.b)
    add(a, b, l)
    add(b, a, l)
  }
  const isSwitch = new Set(config.switches.map(s => s.id))
  const topo = { adj, isSwitch, switches: Object.fromEntries(config.switches.map(s => [s.id, s])) }
  // MAC table of each switch, as if it had already learned every IED's
  // address from the source field of frames it received: { [sw]: { [mac]: port } }
  const macOf = Object.fromEntries(config.ieds.map(d => [d.id, d.mac]))
  topo.macTable = {}
  for (const sw of isSwitch) {
    const t = (topo.macTable[sw] = {})
    for (const e of adj[sw] ?? []) for (const ied of downstreamIeds(topo, e.peer, e.link)) t[macOf[ied]] = e.port
  }
  return topo
}

export const BROADCAST = 'FF-FF-FF-FF-FF-FF'
// The lowest bit of the first byte marks a group (multicast or broadcast) address
export const isGroupMac = mac => (parseInt(mac.slice(0, 2), 16) & 1) === 1

export const serializationS = (bytes, mbps) => ((bytes + PREAMBLE_IFG_BYTES) * 8) / (mbps * 1e6)

// IEDs reachable from `dev` without going back over `viaLink` (ignores state)
function downstreamIeds(topo, dev, viaLink, seen = new Set()) {
  if (seen.has(dev)) return []
  seen.add(dev)
  if (!topo.isSwitch.has(dev)) return [dev]
  return (topo.adj[dev] ?? []).filter(e => e.link !== viaLink).flatMap(e => downstreamIeds(topo, e.peer, e.link, seen))
}

const linkIsDown = (scenario, linkId, t) => {
  const d = scenario.linkDown?.[linkId]
  return d !== undefined && d !== null && t >= d - 1e-12
}
const switchIsDown = (scenario, sw, t) => {
  const d = scenario.switchDown?.[sw]
  return d !== undefined && d !== null && t >= d - 1e-12
}

const dropped = (scenario, linkId, frame) =>
  (scenario.drops ?? []).some(d => d.link === linkId && d.gocb === frame.gocb && d.st === frame.pdu.stNum && d.sq === frame.pdu.sqNum)

// Carry a frame from its publisher through the network.
// Returns { hops, arrivals: [{ ied, t }], losses: [{ ied, where, kind, link }] }
export function forward(topo, config, scenario, frame, t0) {
  const ser = serializationS(frame.length, config.network.linkMbps)
  const swLat = config.network.switchLatencyUs * 1e-6
  const vlan = frame.vlan.id
  const hops = [], arrivals = [], losses = []
  const lose = (dev, link, where, kind) => {
    for (const ied of downstreamIeds(topo, dev, link)) losses.push({ ied, where, kind, link })
  }

  // RSTP: a standby link forwards only once the link it backs has failed and
  // the recovery time has passed; until then it is blocked (no traffic, no loss).
  const linkDef = id => config.links.find(l => l.id === id)
  const rec = (config.network.rstpRecoveryMs ?? 50) / 1000
  const visited = new Set()
  function from(dev, inLink, t) {
    if (visited.has(dev)) return // a frame never passes a switch twice
    visited.add(dev)
    for (const e of topo.adj[dev] ?? []) {
      if (e.link === inLink) continue
      const ld = linkDef(e.link)
      if (ld?.rstp === 'standby') {
        const downAt = scenario.linkDown?.[ld.backs]
        const backsDown = downAt !== undefined && downAt !== null && t >= downAt - 1e-12
        if (!backsDown) continue // blocked by spanning tree
        if (t < downAt + rec) {
          hops.push({ link: e.link, from: dev, to: e.peer, t0: t, t1: t, fate: 'down' })
          lose(e.peer, e.link, `RSTP still reconfiguring after ${ld.backs} failed (until ${((downAt + rec) * 1000).toFixed(1)} ms)`, 'rstp')
          continue
        }
      }
      // A publisher sends a control block only on the port it is bound to
      // (with PRP, both halves of that port: P.A and P.B)
      if (dev === frame.pub && frame.port && e.port !== frame.port && !String(e.port).startsWith(`${frame.port}.`)) continue
      if (topo.isSwitch.has(dev)) {
        // Known unicast: only out of the port the address was learned on
        const learned = topo.macTable[dev]?.[frame.dst]
        if (!isGroupMac(frame.dst) && learned !== undefined && learned !== e.port) continue
        // Multicast filtering (when configured): only to ports that asked for the group
        const sw = topo.switches[dev]
        if (sw.mcastFilter && isGroupMac(frame.dst) && frame.dst !== BROADCAST && !(sw.ports[e.port]?.groups ?? []).includes(frame.dst)) continue
      }
      const hop = { link: e.link, from: dev, to: e.peer, t0: t, t1: t + ser, fate: 'ok' }
      hops.push(hop)
      // Egress: a switch only sends on ports that carry the VLAN
      if (topo.isSwitch.has(dev) && !topo.switches[dev].ports[e.port]?.vlans.includes(vlan)) {
        hop.fate = 'vlan'
        hop.t1 = t
        lose(e.peer, e.link, `${dev} port ${e.port} is not in VLAN ${vlan}`, 'vlan')
        continue
      }
      if (linkIsDown(scenario, e.link, t)) {
        hop.fate = 'down'
        lose(e.peer, e.link, `link ${e.link} down`, 'down')
        continue
      }
      const deadSw = [dev, e.peer].find(x => topo.isSwitch.has(x) && switchIsDown(scenario, x, t))
      if (deadSw) {
        hop.fate = 'down'
        lose(e.peer, e.link, `switch ${deadSw} down`, 'down')
        continue
      }
      if (dropped(scenario, e.link, frame)) {
        hop.fate = 'dropped'
        lose(e.peer, e.link, `frame lost on link ${e.link}`, 'dropped')
        continue
      }
      if (topo.isSwitch.has(e.peer)) {
        // Ingress: a port that doesn't carry the VLAN discards the tagged frame
        if (!topo.switches[e.peer].ports[e.peerPort]?.vlans.includes(vlan)) {
          hop.fate = 'vlan'
          lose(e.peer, e.link, `${e.peer} port ${e.peerPort} is not in VLAN ${vlan}`, 'vlan')
          continue
        }
        from(e.peer, e.link, hop.t1 + swLat) // store-and-forward
      } else {
        arrivals.push({ ied: e.peer, t: hop.t1, via: dev, link: e.link })
      }
    }
  }
  from(frame.pub, null, t0)
  return { hops, arrivals, losses }
}
