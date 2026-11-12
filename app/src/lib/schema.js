// Config schema: the station as data (IEDs, switches, links, GOOSE control
// blocks, subscriptions), scripted protection timing, and feature toggles.
// Nothing in the engine names a specific device: slice 1 is simply a config
// with one bay (line A–B). More bays are more entries in these lists.
//
// Units: protection-relevant times in cycles (as the Line Protection
// Simulator); communication times in ms; network in Mbit/s and µs.

export const SCHEMA_VERSION = 1

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
    },
    // Communication stack time in each IED (logic ⇄ wire). Illustrative:
    // roughly the 40 % / 20 % / 40 % split of a 3 ms budget.
    stack: { publishMs: 1.0, subscribeMs: 1.0 },
    network: { linkMbps: 100, switchLatencyUs: 5 },
    goose: { profile: 'typical' },

    ieds: [
      { id: '21-AB', kind: 'relay', bay: 'AB', name: 'LineProtAB', label: 'Line relay',
        mac: '02-00-00-AB-00-21', mode: 'on', lphdSim: false },
      { id: '52-AB', kind: 'breaker', bay: 'AB', name: 'BkrCtlAB', label: 'Breaker IED',
        mac: '02-00-00-AB-00-52', mode: 'on', lphdSim: false },
    ],
    switches: [
      { id: 'SW1', label: 'Bay switch', ports: { 1: { vlans: [10] }, 2: { vlans: [10] } } },
    ],
    // Endpoints: an IED id, or "switch:port"
    links: [
      { id: 'L1', a: '21-AB', b: 'SW1:1' },
      { id: 'L2', a: 'SW1:2', b: '52-AB' },
    ],
    gocbs: [
      {
        id: 'AB.Trip', ied: '21-AB', label: 'Trip',
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
    features: { networkDetail: false },
  }
}

// One step per schema version. v1 is the first; future steps go here.
const MIGRATIONS = {
  // 1: cfg => { ...cfg, version: 2, ... },
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
