// Optional features, all off by default. One place decides whether a feature
// is active; components never read config.features directly.
export const FEATURES = [
  { id: 'networkDetail', label: 'Network detail', help: 'Per-hop timing, switch ports and VLANs, and the full Ethernet / 802.1Q header in the frame view.' },
  { id: 'testMode', label: 'Test mode', help: 'Put an IED into test or test/blocked (tap it in the bay view). Its messages carry the test flag (Foundations B6).' },
  { id: 'sampledValues', label: 'Sampled Values (merging units)', help: 'A merging unit in each line bay publishes the CT and VT samples; the line relay measures from the stream instead of from wires.' },
  { id: 'transformerBay', label: 'Transformer bay and bus differential', help: 'Adds the transformer tap A–T (87T with HV and LV merging units) and bus differential 87B on bus A. Includes the second bay and Sampled Values.' },
  { id: 'timeSync', label: 'Time sync (PTP grandmasters)', help: 'Two GPS grandmaster clocks on the process bus; the merging units follow them. Fail one, lose GPS, and watch smpSynch. Includes Sampled Values.' },
  { id: 'mms', label: 'MMS reports to the gateway', help: 'Each relay reports its trip, breaker failure and breaker position to the gateway / HMI over the station bus (MMS buffered reports). Fail the station bus and watch what SCADA sees. With PRP, the station bus is doubled too.' },
  { id: 'controls', label: 'MMS controls (operate a breaker)', help: 'The operator opens or closes a breaker from SCADA: select before operate, through the relay’s CSWI, on to the breaker IED over GOOSE, with interlocking. Tap the gateway to give a command. Includes MMS reports.' },
  { id: 'redundancy', label: 'Redundant process bus', help: 'PRP: two independent networks, every frame sent on both (the station bus too, with MMS on). RSTP: one network with a ring link on standby that takes over after a failure.' },
  { id: 'secondBay', label: 'Second bay and breaker failure', help: 'Line A–X on the same bus, its own switch, and breaker failure trips between the bays.' },
]

export function isActive(config, feature) {
  return !!config.features?.[feature]
}
