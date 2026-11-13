// Config schema: the station as data (IEDs, switches, links, GOOSE control
// blocks, subscriptions), scripted protection timing, and feature toggles.
// Nothing in the engine names a specific device: slice 1 is simply a config
// with one bay (line A–B). More bays are more entries in these lists.
//
// Units: protection-relevant times in cycles (as the Line Protection
// Simulator); communication times in ms; network in Mbit/s and µs.

export const SCHEMA_VERSION = 10

// Retransmission profiles. IEC 61850-8-1 leaves the curve to the
// implementation; these are illustrative. Each frame's timeAllowedtoLive is
// talFactor × the interval to the next scheduled frame.
export const PROFILES = {
  typical: {
    label: 'Typical (illustrative)',
    intervalsMs: [2, 4, 8, 16, 32, 64, 128, 256, 512], // after a state change
    heartbeatMs: 1000,
    talFactor: 2,
  },
}

// IEC 61850-5 transfer-time class for trip messages (type 1A) in
// transmission substations (performance class P2/P3): TT6, 3 ms, measured
// from logic in the publisher to logic in the subscriber.
export const TRIP_CLASS = { name: 'TT6', ms: 3 }

export const ETHERTYPE_GOOSE = 0x88b8

export function defaultConfig() {
  return {
    version: SCHEMA_VERSION,
    freqHz: 60,
    timing: {
      relayTripCycles: 1,   // fault → PTRC trip (scripted, illustrative)
      breakerOpenCycles: 2, // trip coil → main contacts parted (illustrative)
      tripResetCycles: 1,   // contacts parted → relay trip resets (current gone)
      auxMoveMs: 15,        // trip coil → Pos leaves "on" (mechanism moving)
      auxSettleMs: 5,       // contacts parted → Pos reads "off"
      bfCycles: 8,          // breaker failure: trip → BF trip if current still flows (illustrative)
      svLossMs: 1,          // relay declares an SV stream lost after this long without new samples (illustrative)
      breakerCloseCycles: 5, // close coil → main contacts make (illustrative)
    },
    // The scripted fault: where it is ('AB' / 'AX' line, 'BUSA' bus A, 'XFMRAT'
    // transformer A–T). The relay whose zone it is in (`protects`, else `line`) trips.
    script: { faultLine: 'AB' },
    // Communication stack time in each IED (logic ⇄ wire). Illustrative:
    // roughly the 40 % / 20 % / 40 % split of a 3 ms budget.
    stack: { publishMs: 1.0, subscribeMs: 1.0 },
    // redundancy: which scheme the redundancy feature uses ('prp' | 'rstp').
    // prpLifeCheckMs: a PRP node alarms when one LAN has been silent this long (illustrative).
    // rstpRecoveryMs: how long RSTP takes to unblock the standby ring link (illustrative).
    network: { linkMbps: 100, switchLatencyUs: 5, redundancy: 'prp', prpLifeCheckMs: 2000, rstpRecoveryMs: 50 },
    goose: { profile: 'typical' },
    // PTP (feature timeSync), all illustrative: the backup grandmaster takes over
    // failoverS after the grandmaster fails (announce receipt timeout); a merging
    // unit keeps its sync muHoldoverS after losing the grandmaster; a grandmaster
    // stays within spec gmHoldoverS after losing GPS.
    ptp: { failoverS: 3, muHoldoverS: 2, gmHoldoverS: 100 },
    // MMS (feature mms), all illustrative: a relay's report leaves serverMs after
    // the data changed; the gateway declares an association lost after
    // assocTimeoutS without an answer and re-establishes it reconnectS after the
    // path returns. Controls (feature controls): the operator confirms operatorS
    // after the select is confirmed; the relay ends a command that has not
    // reached its position operTimeoutS after the operate.
    mms: { serverMs: 5, assocTimeoutS: 1, reconnectS: 0.3, operatorS: 0.2, operTimeoutS: 1 },

    ieds: [
      { id: '21-AB', kind: 'relay', bay: 'AB', line: 'AB', name: 'LineProtAB', label: 'Line relay',
        mac: '02-00-00-AB-00-21', mode: 'on', lphdSim: false },
      { id: '52-AB', kind: 'breaker', bay: 'AB', name: 'BkrCtlAB', label: 'Breaker IED (PIU)',
        mac: '02-00-00-AB-00-52', mode: 'on', lphdSim: false },
      // Station level: MMS client of every relay (feature mms), gateway to SCADA
      { id: 'GW', kind: 'hmi', name: 'Gateway', label: 'Gateway / HMI', mac: '02-00-00-00-00-99', mode: 'on', lphdSim: false },
    ],
    // Station bus (VLAN 20): relays' station ports and the gateway.
    // Process bus (VLAN 10): relays' process ports and the breaker IEDs.
    switches: [
      { id: 'PB', label: 'Process bus', ports: { 1: { vlans: [10] }, 2: { vlans: [10] } } },
      { id: 'SB', label: 'Station bus', ports: { 1: { vlans: [20] }, 2: { vlans: [20] } } },
    ],
    // Endpoints: "ied" or "ied:port" (P = process, S = station), or "switch:port"
    links: [
      { id: 'L1', a: '21-AB:P', b: 'PB:1' },
      { id: 'L2', a: 'PB:2', b: '52-AB' },
      { id: 'L3', a: '21-AB:S', b: 'SB:1' },
      { id: 'L4', a: 'SB:2', b: 'GW' },
    ],
    gocbs: [
      {
        id: 'AB.Trip', ied: '21-AB', label: 'Trip', port: 'P', // published on the process-bus port
        gocbRef: 'LineProtABPROT/LLN0$GO$Trip', datSet: 'LineProtABPROT/LLN0$DS_Trip', goID: 'AB_Trip',
        mac: '01-0C-CD-01-00-01', appid: 0x0101, vlan: { id: 10, priority: 4 }, confRev: 1,
        entries: [
          { ref: 'PROT/PTRC1.Tr.general', type: 'BOOLEAN', signal: 'trip' },
          { ref: 'PROT/PTRC1.Tr.q', type: 'Quality', signal: 'trip' },
        ],
      },
      {
        id: 'AB.Pos', ied: '52-AB', label: 'Position',
        gocbRef: 'BkrCtlABCTRL/LLN0$GO$Pos', datSet: 'BkrCtlABCTRL/LLN0$DS_Pos', goID: 'AB_Pos',
        mac: '01-0C-CD-01-00-02', appid: 0x0102, vlan: { id: 10, priority: 4 }, confRev: 1,
        entries: [
          { ref: 'CTRL/XCBR1.Pos.stVal', type: 'Dbpos', signal: 'pos' },
          { ref: 'CTRL/XCBR1.Pos.q', type: 'Quality', signal: 'pos' },
        ],
      },
    ],
    // What each subscriber expects, as engineered into it (from the SCD).
    // use: what the subscribing IED does with the data.
    subscriptions: [
      { id: '52-AB.Trip', ied: '52-AB', gocb: 'AB.Trip', use: 'tripCoil',
        expect: { mac: '01-0C-CD-01-00-01', appid: 0x0101, gocbRef: 'LineProtABPROT/LLN0$GO$Trip', datSet: 'LineProtABPROT/LLN0$DS_Trip', confRev: 1 } },
      { id: '21-AB.Pos', ied: '21-AB', gocb: 'AB.Pos', use: 'breakerPos',
        expect: { mac: '01-0C-CD-01-00-02', appid: 0x0102, gocbRef: 'BkrCtlABCTRL/LLN0$GO$Pos', datSet: 'BkrCtlABCTRL/LLN0$DS_Pos', confRev: 1 } },
    ],
    features: { networkDetail: false, testMode: false, secondBay: false, redundancy: false, sampledValues: false, transformerBay: false, timeSync: false, mms: false, controls: false },
  }
}

// One step per schema version.
const MIGRATIONS = {
  // v9 → v10: MMS controls, breaker close time
  9: cfg => ({ ...cfg, version: 10, timing: { breakerCloseCycles: 5, ...cfg.timing }, mms: { operatorS: 0.2, operTimeoutS: 1, ...cfg.mms }, features: { controls: false, ...cfg.features } }),
  // v8 → v9: MMS on the station bus
  8: cfg => ({ ...cfg, version: 9, mms: cfg.mms ?? { serverMs: 5, assocTimeoutS: 1, reconnectS: 0.3 }, features: { mms: false, ...cfg.features } }),
  // v7 → v8: time sync feature and PTP figures
  7: cfg => ({ ...cfg, version: 8, ptp: cfg.ptp ?? { failoverS: 3, muHoldoverS: 2, gmHoldoverS: 100 }, features: { timeSync: false, ...cfg.features } }),
  // v6 → v7: transformer bay and bus differential feature
  6: cfg => ({ ...cfg, version: 7, features: { transformerBay: false, ...cfg.features } }),
  // v5 → v6: Sampled Values feature, SV loss detection time
  5: cfg => ({ ...cfg, version: 6, timing: { svLossMs: 1, ...cfg.timing }, features: { sampledValues: false, ...cfg.features } }),
  // v4 → v5: redundancy scheme (PRP or RSTP), RSTP recovery time
  4: cfg => ({ ...cfg, version: 5, network: { redundancy: 'prp', rstpRecoveryMs: 50, ...cfg.network } }),
  // v3 → v4: redundancy feature (PRP process bus), PRP life-check interval
  3: cfg => ({
    ...cfg,
    version: 4,
    network: { ...cfg.network, prpLifeCheckMs: cfg.network?.prpLifeCheckMs ?? 2000 },
    features: { redundancy: false, ...cfg.features },
  }),
  // v2 → v3: bay switch replaced by station bus + process bus (topology from the defaults)
  2: cfg => {
    const d = defaultConfig()
    return { ...cfg, version: 3, ieds: d.ieds, switches: d.switches, links: d.links, gocbs: d.gocbs, subscriptions: d.subscriptions }
  },
  // v1 → v2: test-mode and second-bay features, relay line, fault script, BF timer
  1: cfg => ({
    ...cfg,
    version: 2,
    timing: { ...cfg.timing, bfCycles: cfg.timing?.bfCycles ?? 8 },
    script: cfg.script ?? { faultLine: 'AB' },
    ieds: cfg.ieds.map(d => (d.kind === 'relay' && !d.line ? { ...d, line: d.bay } : d)),
    features: { testMode: false, secondBay: false, ...cfg.features },
  }),
}

export function migrateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return defaultConfig()
  let c = { ...cfg, version: cfg.version ?? 1 }
  while (c.version < SCHEMA_VERSION) {
    const step = MIGRATIONS[c.version]
    if (!step) return defaultConfig()
    c = step(c)
  }
  return c
}

// Lookups
export const iedById = (config, id) => config.ieds.find(d => d.id === id)
export const gocbById = (config, id) => config.gocbs.find(g => g.id === id)
export const subById = (config, id) => config.subscriptions.find(s => s.id === id)
export const subsOfGocb = (config, gocbId) => config.subscriptions.filter(s => s.gocb === gocbId)
