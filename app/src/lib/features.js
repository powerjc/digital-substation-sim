// Optional features, all off by default. One place decides whether a feature
// is active; components never read config.features directly.
export const FEATURES = [
  { id: 'networkDetail', label: 'Network detail', help: 'Per-hop timing, switch ports and VLANs, and the full Ethernet / 802.1Q header in the frame view.' },
  { id: 'testMode', label: 'Test mode', help: 'Put an IED into test or test/blocked (tap it in the bay view). Its messages carry the test flag (Foundations B6).' },
  { id: 'redundancy', label: 'Redundant process bus (PRP)', help: 'Two independent process-bus networks, LAN A and LAN B. Every relay and breaker IED sends each frame on both and uses the first copy.' },
  { id: 'secondBay', label: 'Second bay and breaker failure', help: 'Line A–X on the same bus, its own switch, and breaker failure trips between the bays.' },
]

export function isActive(config, feature) {
  return !!config.features?.[feature]
}
