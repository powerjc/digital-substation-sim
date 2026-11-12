// Optional features, all off by default. One place decides whether a feature
// is active; components never read config.features directly.
export const FEATURES = [
  { id: 'networkDetail', label: 'Network detail', help: 'Per-hop timing, switch ports and VLANs, and the full Ethernet / 802.1Q header in the frame view.' },
]

export function isActive(config, feature) {
  return !!config.features?.[feature]
}
