import { describe, it, expect } from 'vitest'
import { defaultConfig, migrateConfig, SCHEMA_VERSION, PROFILES, TRIP_CLASS } from './schema'
import { simulate, stateAt, START_T } from './timeline'
import { matchFrame, sequenceCheck, testHandling, frameLength } from './goose'
import { serializationS } from './network'
import { applyScenario, countFailures, EMPTY_SCENARIO } from './scenario'
import { isActive } from './features'
import { fmtTime, fmtDur, fmtProt } from './units'
import { LESSONS } from './lessons'
import { stationConfig } from './station'
import { TOUR } from './tour'
import { chapterById } from './foundations'
import { simulationDecision } from './goose'
import { svRate, smpCntAt, instantValues, sampleAt, PHASORS } from './sv'

const run = (sc = {}, cfg = defaultConfig()) => simulate(cfg, sc)
const ev = (r, kind, dev) => r.events.find(e => e.kind === kind && (!dev || e.dev === dev))
const ms = s => Math.round(s * 1e5) / 100 // s → ms, 2 decimals
const tripFrames = r => r.frames.filter(f => f.gocb === 'AB.Trip')

describe('schema', () => {
  it('is at v7 and migrates a current config unchanged', () => {
    const c = defaultConfig()
    expect(c.version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(7)
    expect(migrateConfig(c)).toEqual(c)
    expect(migrateConfig(null)).toEqual(defaultConfig())
  })
  it('migrates a v1 config to v7: features, script, BF timer, station / process bus, PRP, RSTP, SV, transformer bay', () => {
    const v1 = defaultConfig()
    v1.version = 1
    delete v1.script
    delete v1.timing.bfCycles
    v1.features = { networkDetail: true }
    v1.ieds = v1.ieds.map(({ line, ...d }) => d)
    v1.switches = [{ id: 'SW1', label: 'Bay switch', ports: { 1: { vlans: [10] }, 2: { vlans: [10] } } }]
    v1.links = [{ id: 'L1', a: '21-AB', b: 'SW1:1' }, { id: 'L2', a: 'SW1:2', b: '52-AB' }]
    const m = migrateConfig(v1)
    expect(m.version).toBe(7)
    expect(m.timing.svLossMs).toBe(1)
    expect(m.network.redundancy).toBe('prp')
    expect(m.network.rstpRecoveryMs).toBe(50)
    expect(m.switches.map(x => x.id)).toEqual(['PB', 'SB'])
    expect(m.network.prpLifeCheckMs).toBe(2000)
    expect(m.features).toEqual({ networkDetail: true, testMode: false, secondBay: false, redundancy: false, sampledValues: false, transformerBay: false })
    expect(m.script).toEqual({ faultLine: 'AB' })
    expect(m.timing.bfCycles).toBe(8)
    expect(m.ieds.find(d => d.id === '21-AB').line).toBe('AB')
  })
  it('has every feature off by default', () => {
    const c = defaultConfig()
    expect(Object.values(c.features).every(v => !v)).toBe(true)
    expect(isActive(c, 'networkDetail')).toBe(false)
  })
  it('names no device in the engine: the bay is data', () => {
    const c = defaultConfig()
    expect(c.ieds.map(d => d.id)).toEqual(['21-AB', '52-AB', 'GW'])
    expect(c.switches.map(x => x.id)).toEqual(['PB', 'SB'])
    expect(c.subscriptions.every(s => c.gocbs.some(g => g.id === s.gocb))).toBe(true)
  })
})

describe('normal run (lesson 1 figures)', () => {
  const r = run()
  const f = r.config.freqHz

  it('is deterministic', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(r))
  })
  it('trips at 1 cycle (16.7 ms)', () => {
    expect(ms(ev(r, 'trip').t)).toBeCloseTo(16.67, 2)
    expect(fmtProt(ev(r, 'trip').t, f)).toBe('16.7 ms (1.0 cyc)')
  })
  it('starts the run healthy, with no alarm', () => {
    const s = r.events[0].state
    expect(r.events[0].t).toBe(START_T)
    expect(Object.values(s.subs).every(x => x.status === 'healthy')).toBe(true)
    expect(r.events.some(e => e.kind === 'alarm')).toBe(false)
  })
  it('first frame after the trip: stNum 2, sqNum 0, TAL 4 ms', () => {
    const first = tripFrames(r).find(x => x.sendT > 0)
    expect(first.pdu.stNum).toBe(2)
    expect(first.pdu.sqNum).toBe(0)
    expect(first.pdu.timeAllowedtoLive).toBe(4)
    expect(first.rx['52-AB.Trip'].fate).toBe('new')
  })
  it('retransmits 2, 4, 8, 16 ms apart with TAL = 2 × the next gap, then backs off to the 1 s heartbeat', () => {
    const burst = tripFrames(r).filter(x => x.sendT > 0 && x.pdu.stNum === 2)
    const gaps = burst.slice(1).map((x, i) => ms(x.sendT - burst[i].sendT))
    expect(gaps.slice(0, 4)).toEqual([2, 4, 8, 16])
    burst.slice(0, -1).forEach((x, i) => expect(x.pdu.timeAllowedtoLive).toBeCloseTo(2 * gaps[i], 6))
    expect(burst.map(x => x.pdu.sqNum)).toEqual(burst.map((_, i) => i))
    burst.slice(1).forEach(x => expect(x.rx['52-AB.Trip'].fate).toBe('repeat'))
    const quiet = tripFrames(r).filter(x => x.sendT < 0)
    expect(ms(quiet[1].sendT - quiet[0].sendT)).toBe(PROFILES.typical.heartbeatMs)
    expect(quiet[0].pdu.timeAllowedtoLive).toBe(2000)
    const last = tripFrames(r).at(-1)
    expect(last.pdu.timeAllowedtoLive).toBe(2000)
  })
  it('trip coil at 18.7 ms: transfer time 2.03 ms, inside the 3 ms class', () => {
    expect(ms(ev(r, 'coil').t)).toBeCloseTo(18.7, 1)
    expect(fmtDur(r.outcome.transferT)).toBe('2.03 ms')
    expect(r.outcome.verdict).toBe('delivered')
    expect(r.outcome.transferT * 1000).toBeLessThan(TRIP_CLASS.ms)
  })
  it('network share is about 31 µs; the IEDs take the rest', () => {
    const b = r.outcome.budget
    expect(Math.round(b.networkS * 1e6)).toBe(31)
    expect(b.waitS).toBeCloseTo(0, 9)
    expect(b.publishS + b.networkS + b.subscribeS).toBeCloseTo(r.outcome.transferT, 9)
  })
  it('frame lengths and serialization are plausible', () => {
    const fr = tripFrames(r)[0]
    expect(fr.length).toBeGreaterThan(100)
    expect(fr.length).toBeLessThan(200)
    expect(frameLength(fr.pdu)).toBe(fr.length)
    expect(serializationS(fr.length, 100) * 1e6).toBeGreaterThan(9)
    expect(serializationS(fr.length, 100) * 1e6).toBeLessThan(20)
  })
  it('breaker opens at 52.0 ms (3.1 cyc); Position goes intermediate then open; 21-AB sees open at 59.1 ms', () => {
    expect(fmtProt(ev(r, 'open').t, f)).toBe('52.0 ms (3.1 cyc)')
    const pos = r.frames.filter(x => x.gocb === 'AB.Pos' && x.pdu.sqNum === 0).map(x => x.pdu.allData[0].value)
    expect(pos).toEqual(['intermediate', 'off'])
    const seen = r.events.filter(e => e.kind === 'seen')
    expect(seen.at(-1).text).toMatch(/open$/)
    expect(ms(seen.at(-1).t)).toBeCloseTo(59.06, 2)
  })
  it('the trip resets after the breaker opens: a third Trip state', () => {
    const reset = tripFrames(r).find(x => x.pdu.stNum === 3 && x.pdu.sqNum === 0)
    expect(reset.pdu.allData[0].value).toBe(false)
    expect(reset.sendT).toBeGreaterThan(ev(r, 'open').t)
  })
  it('stateAt returns the snapshot of the latest event', () => {
    const { state } = stateAt(r.events, 0.03)
    expect(state.ieds['52-AB'].coil).toBe(true)
    expect(state.ieds['21-AB'].trip).toBe(true)
  })
})

describe('subscriber checks', () => {
  const c = defaultConfig()
  const r = run()
  const fr = tripFrames(r)[0]
  const sub = c.subscriptions[0]
  it('accepts the engineered frame', () => {
    expect(matchFrame(fr, sub).fate).toBe('ok')
  })
  it('ignores a wrong APPID silently, rejects a wrong gocbRef / datSet / confRev', () => {
    for (const [field, fate] of [['appid', 'ignored'], ['gocbRef', 'rejected'], ['datSet', 'rejected'], ['confRev', 'rejected']]) {
      const cfg = applyScenario(c, { subWrong: { '52-AB.Trip': field } })
      const rr = simulate(c, { subWrong: { '52-AB.Trip': field } })
      const m = matchFrame(tripFrames(rr)[0], cfg.subscriptions[0])
      expect(m.fate).toBe(fate)
      expect(m.compare.length).toBe(1)
    }
  })
  it('sequence: new state, repeat, duplicate, missed states', () => {
    const s = { lastSt: 2, lastSq: 3 }
    expect(sequenceCheck(s, { pdu: { stNum: 2, sqNum: 4 } }).kind).toBe('repeat')
    expect(sequenceCheck(s, { pdu: { stNum: 2, sqNum: 3 } }).kind).toBe('old')
    expect(sequenceCheck(s, { pdu: { stNum: 3, sqNum: 0 } }).kind).toBe('new')
    expect(sequenceCheck(s, { pdu: { stNum: 5, sqNum: 0 } }).note).toMatch(/2 state change/)
    expect(sequenceCheck({ lastSt: null, lastSq: null }, { pdu: { stNum: 7, sqNum: 9 } }).kind).toBe('new')
  })
  it('test-mode hook passes everything through in slice 1', () => {
    expect(testHandling(c.ieds[1], fr)).toEqual({ use: true, note: null })
    expect(fr.pdu.simulation).toBe(false)
    expect(fr.pdu.allData[1].value.test).toBe(false)
  })
})

describe('failures', () => {
  it('scenario helpers', () => {
    expect(countFailures(EMPTY_SCENARIO)).toBe(0)
    expect(countFailures({ linkDown: { L1: 0 }, drops: [{}], subWrong: { x: 'appid' }, vlanMissing: [{}] })).toBe(4)
    const c = defaultConfig()
    applyScenario(c, { subWrong: { '52-AB.Trip': 'confRev' } })
    expect(c.gocbs[0].confRev).toBe(1) // the base config is not mutated
  })

  it('lesson 3: first frame lost → sqNum 1 delivers, transfer 4.03 ms, beyond the class', () => {
    const r = run({ drops: [{ link: 'L1', gocb: 'AB.Trip', st: 2, sq: 0 }] })
    expect(r.outcome.verdict).toBe('late')
    expect(fmtDur(r.outcome.transferT)).toBe('4.03 ms')
    expect(r.outcome.deliveredBy.sq).toBe(1)
    expect(r.outcome.transferT * r.config.freqHz).toBeCloseTo(0.24, 2) // "about a quarter of a cycle"
    const lost = tripFrames(r).find(x => x.pdu.stNum === 2 && x.pdu.sqNum === 0)
    expect(lost.rx['52-AB.Trip'].fate).toBe('lost')
    expect(lost.hops[0].fate).toBe('dropped')
  })

  it('lesson 3: link fails 2 s before the fault → LOST at −0.600 s (1.4 s later), trip never delivered', () => {
    const r = run({ linkDown: { L1: -2.0 } })
    const stale = ev(r, 'stale', '52-AB')
    expect(fmtTime(stale.t)).toBe('−600.0 ms')
    expect(stale.t - -2.0).toBeCloseTo(1.4, 3) // + the last heartbeat's ~31 µs network delay
    expect(stale.text).toMatch(/TAL \(2000 ms\)/)
    expect(r.outcome.verdict).toBe('notDelivered')
    expect(ev(r, 'coil')).toBeUndefined()
  })

  it('lesson 3: link fails at the fault → no alarm before the trip, alarm at 1.400 s', () => {
    const r = run({ linkDown: { L1: 0 } })
    expect(r.events.filter(e => ['stale', 'alarm', 'mismatch'].includes(e.kind) && e.t < 0.0167)).toEqual([])
    expect(fmtTime(ev(r, 'stale', '52-AB').t)).toBe('1.400 s')
    expect(r.outcome.verdict).toBe('notDelivered')
  })

  it('link down for the whole run → NO MSG standing at the start', () => {
    const r = run({ linkDown: { L1: -Infinity } })
    expect(r.events[0].state.subs['52-AB.Trip'].status).toBe('noMsg')
    expect(r.events.some(e => e.kind === 'alarm' && e.sub === '52-AB.Trip')).toBe(true)
  })

  it('lesson 2: wrong APPID → every trip frame ignored, NO MSG since before the run, breaker stays closed', () => {
    const r = run({ subWrong: { '52-AB.Trip': 'appid' } })
    expect(r.outcome.verdict).toBe('notDelivered')
    expect(tripFrames(r).every(x => x.rx['52-AB.Trip'].fate === 'ignored')).toBe(true)
    expect(r.events[0].state.subs['52-AB.Trip'].status).toBe('noMsg')
    expect(r.events.at(-1).state.ieds['52-AB'].contactsClosed).toBe(true)
  })

  it('lesson 2: wrong gocbRef or re-issued publisher → rejected, CONFIG alarm says why', () => {
    for (const field of ['gocbRef', 'confRev']) {
      const r = run({ subWrong: { '52-AB.Trip': field } })
      expect(r.outcome.verdict).toBe('notDelivered')
      expect(r.events[0].state.subs['52-AB.Trip'].status).toBe('mismatch')
      expect(r.events[0].state.subs['52-AB.Trip'].reason).toMatch(field)
      expect(tripFrames(r).every(x => x.rx['52-AB.Trip'].fate === 'rejected')).toBe(true)
    }
  })

  it('lesson 2: process-bus port 2 out of VLAN 10 → dropped at the switch, both directions lost', () => {
    const r = run({ vlanMissing: [{ sw: 'PB', port: 2, vlan: 10 }] })
    expect(r.outcome.verdict).toBe('notDelivered')
    expect(tripFrames(r)[0].rx['52-AB.Trip'].reason).toMatch(/PB port 2 is not in VLAN 10/)
    expect(r.events[0].state.subs['52-AB.Trip'].status).toBe('noMsg')
    expect(r.events[0].state.subs['21-AB.Pos'].status).toBe('noMsg')
  })
})

describe('lessons', () => {
  for (const l of LESSONS) {
    it(`${l.title}: ${l.expect.verdict}`, () => {
      const cfg = defaultConfig()
      l.setup?.(cfg)
      expect(simulate(stationConfig(cfg), l.scenario).outcome.verdict).toBe(l.expect.verdict)
    })
  }
})

const withFeatures = (...fs) => { const c = defaultConfig(); for (const f of fs) c.features[f] = true; return stationConfig(c) }

describe('slice 1.1: test mode', () => {
  const cfg = withFeatures('testMode')
  it('a relay left in test: trip ignored by a normal-mode breaker IED, subscription stays OK, no alarm', () => {
    const r = simulate(cfg, { iedMode: { '21-AB': 'test' } })
    expect(r.outcome.verdict).toBe('notDelivered')
    const trips = tripFrames(r).filter(f => f.sendT > 0 && f.pdu.stNum === 2)
    expect(trips.every(f => f.pdu.allData[1].value.test)).toBe(true)
    expect(trips.every(f => f.rx['52-AB.Trip'].fate === 'testIgnored')).toBe(true)
    expect(r.events.at(-1).state.subs['52-AB.Trip'].status).toBe('healthy')
    expect(r.events.some(e => ['alarm', 'stale', 'mismatch'].includes(e.kind))).toBe(false)
    expect(r.outcome.notes.some(n => /mode/.test(n.text))).toBe(true)
  })
  it('both in test: the breaker opens at 52.0 ms as in service', () => {
    const r = simulate(cfg, { iedMode: { '21-AB': 'test', '52-AB': 'test' } })
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtProt(r.outcome.openT, 60)).toBe('52.0 ms (3.1 cyc)')
  })
  it('breaker IED in test/blocked: the trip is processed, the coil never energizes', () => {
    const r = simulate(cfg, { iedMode: { '21-AB': 'test', '52-AB': 'test/blocked' } })
    expect(r.outcome.verdict).toBe('notDelivered')
    expect(ev(r, 'blocked', '52-AB')).toBeTruthy()
    expect(ev(r, 'coil')).toBeUndefined()
  })
  it('simulated messages are used only in simulation mode', () => {
    expect(simulationDecision(true, false).use).toBe(false)
    expect(simulationDecision(true, true).use).toBe(true)
    expect(simulationDecision(false, false).use).toBe(true)
  })
  it('the feature off changes nothing: the default station is slice 1', () => {
    expect(stationConfig(defaultConfig())).toEqual(defaultConfig())
    expect(JSON.stringify(simulate(withFeatures('testMode'), {}).outcome)).toBe(JSON.stringify(run().outcome))
  })
})

describe('slice 2: second bay and breaker failure', () => {
  const cfg = withFeatures('secondBay')
  const f = cfg.freqHz
  it('normal trip in bay A–B is unchanged by the second bay; 21-AX does not trip; no BF', () => {
    const r = simulate(cfg, {})
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtDur(r.outcome.transferT)).toBe('2.03 ms')
    expect(fmtProt(r.outcome.openT, f)).toBe('52.0 ms (3.1 cyc)')
    expect(ev(r, 'trip', '21-AX')).toBeUndefined()
    expect(ev(r, 'bf')).toBeUndefined()
  })
  it('stuck breaker: BF trip at 150.0 ms (9.0 cyc), 52-AX opens at 185.4 ms (11.1 cyc)', () => {
    const r = simulate(cfg, { breakerStuck: ['52-AB'] })
    expect(r.outcome.verdict).toBe('clearedByBF')
    expect(fmtProt(r.outcome.bfT, f)).toBe('150.0 ms (9.0 cyc)')
    expect(fmtProt(r.outcome.clearT, f)).toBe('185.4 ms (11.1 cyc)')
    expect(ev(r, 'stuck', '52-AB')).toBeTruthy()
    const bfFrame = r.frames.find(x => x.gocb === 'AB.BF' && x.pdu.stNum === 2)
    expect(Object.keys(bfFrame.rx)).toEqual(['52-AX.BF-AB'])
    expect(bfFrame.hops.filter(h => h.fate === 'ok').map(h => h.link)).toContain('L5')
  })
  it('a lost trip is saved by breaker failure, unless 52-AX’s process-bus port loses the VLAN', () => {
    expect(simulate(cfg, { subWrong: { '52-AB.Trip': 'appid' } }).outcome.verdict).toBe('clearedByBF')
    const r = simulate(cfg, { subWrong: { '52-AB.Trip': 'appid' }, vlanMissing: [{ sw: 'PB', port: 4, vlan: 10 }] })
    expect(r.outcome.verdict).toBe('notDelivered')
    expect(r.outcome.bfT).not.toBeNull()
  })
  it('the process bus fails 2 s before: all six process-bus subscriptions LOST within 2 s, nothing clears', () => {
    const r = simulate(cfg, { switchDown: { PB: -2.0 } })
    expect(r.outcome.verdict).toBe('notDelivered')
    const lost = [...new Set(r.events.filter(e => e.kind === 'stale' && e.t < 0).map(e => e.sub))].sort()
    expect(lost).toEqual(cfg.subscriptions.map(x => x.id).sort())
    expect(lost).toHaveLength(6)
    expect(Math.max(...r.events.filter(e => e.kind === 'stale').map(e => e.t)) - -2.0).toBeLessThan(2)
  })
  it('the station bus failing instead: protection carries on, breaker opens at 52.0 ms', () => {
    const r = simulate(cfg, { switchDown: { SB: -2.0 } })
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtProt(r.outcome.openT, f)).toBe('52.0 ms (3.1 cyc)')
    expect(r.events.some(e => e.kind === 'stale')).toBe(false)
  })
  it('wrong APPIDs in bay A–B never match bay A–X messages', () => {
    const appids = cfg.gocbs.map(g => g.appid)
    for (const g of cfg.gocbs) expect(appids).not.toContain(g.appid + 0x10)
  })
})

describe('tour', () => {
  const PANELS = ['bay', 'timing', 'frames', 'decoded', 'outcome', 'events', 'header']
  it('every step points at a panel and, when it names one, a built chapter', () => {
    for (const s of TOUR) {
      expect(PANELS).toContain(s.panel)
      if (s.phonePanel) expect(PANELS).toContain(s.phonePanel)
      if (s.chapter) expect(chapterById(s.chapter)?.built, s.chapter).toBe(true)
    }
  })
})

describe('slice 2: missing subscription', () => {
  const cfg = withFeatures('secondBay')
  it('a never-configured BF subscription: frames reach 52-AX unsubscribed, nothing clears, no alarm at all', () => {
    const r = simulate(cfg, { breakerStuck: ['52-AB'], subMissing: ['52-AX.BF-AB'] })
    expect(r.outcome.verdict).toBe('notCleared')
    expect(fmtProt(r.outcome.bfT, cfg.freqHz)).toBe('150.0 ms (9.0 cyc)')
    const bf = r.frames.find(f => f.gocb === 'AB.BF' && f.pdu.stNum === 2)
    expect(bf.unsubscribed).toContain('52-AX')
    expect(Object.keys(bf.rx)).toEqual([])
    expect(r.events.some(e => ['alarm', 'stale', 'mismatch'].includes(e.kind))).toBe(false)
    expect(r.outcome.notes.some(n => /no subscription to supervise/.test(n.text))).toBe(true)
  })
  it('a wrong APPID there instead alarms from before the run; correct, it clears at 185.4 ms', () => {
    const r = simulate(cfg, { breakerStuck: ['52-AB'], subWrong: { '52-AX.BF-AB': 'appid' } })
    expect(r.outcome.verdict).toBe('notCleared')
    expect(r.events[0].state.subs['52-AX.BF-AB'].status).toBe('noMsg')
    expect(fmtProt(simulate(cfg, { breakerStuck: ['52-AB'] }).outcome.clearT, cfg.freqHz)).toBe('185.4 ms (11.1 cyc)')
  })
})

describe('station bus and process bus', () => {
  it('a relay publishes its trip only on its process-bus port: never on the station bus', () => {
    const r = run()
    for (const f of r.frames) {
      const links = f.hops.map(h => h.link)
      expect(links).not.toContain('L3')
      expect(links).not.toContain('L4')
    }
    expect(tripFrames(r)[0].hops.map(h => h.link)).toEqual(['L1', 'L2'])
  })
  it('the gateway is on the station bus (VLAN 20), the breaker IED on the process bus (VLAN 10)', () => {
    const c = defaultConfig()
    expect(c.links.find(l => l.b === 'GW').a).toBe('SB:2')
    expect(c.switches.find(x => x.id === 'SB').ports[2].vlans).toEqual([20])
    expect(c.switches.find(x => x.id === 'PB').ports[2].vlans).toEqual([10])
  })
})

describe('test set and simulation mode', () => {
  const cfg = withFeatures('testMode')
  const sc = { testSet: { imitate: 'AB.Trip', tripAt: null }, simMode: ['52-AB'] }
  it('the test set is on the process bus only with test mode on', () => {
    expect(stationConfig(defaultConfig()).ieds.some(d => d.kind === 'testset')).toBe(false)
    expect(cfg.links.find(l => l.a === 'TS').b).toBe('PB:9')
  })
  it('left in simulation mode: the real trip is ignored, the breaker stays closed, no alarm', () => {
    const r = simulate(cfg, sc)
    expect(r.outcome.verdict).toBe('notDelivered')
    const real = tripFrames(r).filter(f => f.sendT > 0 && f.pdu.stNum === 2)
    expect(real.every(f => f.rx['52-AB.Trip'].fate === 'realIgnored')).toBe(true)
    const simF = r.frames.filter(f => f.gocb === 'AB.Trip.sim')
    expect(simF.length).toBeGreaterThan(0)
    expect(simF.every(f => f.pdu.simulation && f.pdu.gocbRef === real[0].pdu.gocbRef && f.appid === real[0].appid)).toBe(true)
    expect(r.events.some(e => ['alarm', 'stale', 'mismatch'].includes(e.kind))).toBe(false)
    expect(r.outcome.notes.some(n => /simulation mode/.test(n.text))).toBe(true)
  })
  it('simulation mode off: the test set is ignored, breaker opens at 52.0 ms', () => {
    const r = simulate(cfg, { testSet: sc.testSet })
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtProt(r.outcome.openT, 60)).toBe('52.0 ms (3.1 cyc)')
    expect(r.frames.filter(f => f.gocb === 'AB.Trip.sim').every(f => f.rx['52-AB.Trip'].fate === 'simIgnored')).toBe(true)
  })
  it('simulation mode with the test set unplugged: the real trip is used, 52.0 ms', () => {
    const r = simulate(cfg, { simMode: ['52-AB'] })
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtProt(r.outcome.openT, 60)).toBe('52.0 ms (3.1 cyc)')
  })
  it('an injected simulated trip opens the breaker before the fault', () => {
    const r = simulate(cfg, { ...sc, testSet: { imitate: 'AB.Trip', tripAt: -1.0 } })
    expect(r.outcome.verdict).toBe('openBefore')
    expect(r.outcome.openT).toBeLessThan(0)
    expect(simulate(cfg, { testSet: { imitate: 'AB.Trip', tripAt: -1.0 } }).outcome.verdict).toBe('delivered')
  })
})

describe('redundancy: PRP process bus', () => {
  const one = withFeatures('redundancy')
  const two = withFeatures('redundancy', 'secondBay')
  it('splits the process bus into LAN A and LAN B; every relay and breaker IED on both; the test set on LAN A only', () => {
    expect(one.switches.map(x => x.id).sort()).toEqual(['PBA', 'PBB', 'SB'])
    expect(one.links.filter(l => l.a.startsWith('21-AB:P')).map(l => l.b)).toEqual(['PBA:1', 'PBB:1'])
    const ts = withFeatures('redundancy', 'testMode').links.filter(l => l.a === 'TS')
    expect(ts.map(l => l.b)).toEqual(['PBA:9'])
  })
  it('normal run: two copies, the first used, the other discarded; 6-byte trailer; transfer still 2.03 ms', () => {
    const r = simulate(one, {})
    const f = tripFrames(r).find(x => x.sendT > 0)
    expect(f.length).toBe(146)
    expect(f.rct.suffix).toBe(0x88fb)
    expect(f.copies['52-AB.Trip'].map(c => c.used)).toEqual([true, false])
    expect(fmtDur(r.outcome.transferT)).toBe('2.03 ms')
    expect(r.events.some(e => e.kind === 'prpLan')).toBe(false)
  })
  it('LAN A switch fails 2 s before: PRP alarm at every relay and breaker IED within 2 s, no subscription alarm, trip over LAN B, 52.0 ms', () => {
    const r = simulate(two, { switchDown: { PBA: -2.0 } })
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtProt(r.outcome.openT, 60)).toBe('52.0 ms (3.1 cyc)')
    const prp = r.events.filter(e => e.kind === 'prpLan')
    expect([...new Set(prp.map(e => e.dev))].sort()).toEqual(['21-AB', '21-AX', '52-AB', '52-AX'])
    expect(prp.every(e => e.t > -2.0 && e.t <= 0)).toBe(true)
    expect(r.events.some(e => ['stale', 'alarm', 'mismatch'].includes(e.kind))).toBe(false)
    const f = tripFrames(r).find(x => x.sendT > 0)
    expect(f.copies['52-AB.Trip'].find(c => c.lan === 'A').lost).toMatch(/PBA down/)
  })
  it('both LANs gone: the trip is lost, and the reason names both', () => {
    const r = simulate(two, { switchDown: { PBA: -2.0, PBB: 0 } })
    expect(r.outcome.verdict).toBe('notDelivered')
    expect(tripFrames(r).find(x => x.sendT > 0).rx['52-AB.Trip'].reason).toMatch(/LAN A.*LAN B/)
  })
  it('a frame lost on LAN A costs nothing: transfer 2.03 ms (4.03 ms without PRP)', () => {
    const r = simulate(two, { drops: [{ link: 'L1A', gocb: 'AB.Trip', st: 2, sq: 0 }] })
    expect(fmtDur(r.outcome.transferT)).toBe('2.03 ms')
    expect(r.outcome.notes.some(n => /LAN A copy of the trip was lost/.test(n.text))).toBe(true)
  })
  it('the feature off leaves the station unchanged', () => {
    expect(withFeatures('secondBay').switches.map(x => x.id)).toEqual(['PB', 'SB'])
  })
})

describe('redundancy: RSTP ring', () => {
  const rstp = (() => { const c = defaultConfig(); c.features.redundancy = true; c.network.redundancy = 'rstp'; return stationConfig(c) })()
  it('two ring switches, R1 forwarding and R2 blocked; relays on PB1, breaker IEDs on PB2', () => {
    expect(rstp.switches.map(x => x.id).sort()).toEqual(['PB1', 'PB2', 'SB'])
    expect(rstp.links.find(l => l.id === 'R2')).toMatchObject({ rstp: 'standby', backs: 'R1' })
    expect(rstp.links.find(l => l.a === '21-AB:P').b).toBe('PB1:1')
    const r = simulate(rstp, {})
    expect(tripFrames(r).every(f => !f.hops.some(h => h.link === 'R2'))).toBe(true)
    expect(fmtDur(r.outcome.transferT)).toBe('2.05 ms')
  })
  it('R1 fails at the fault: 50 ms of lost frames, sqNum 5 at 79.7 ms delivers, transfer 64.0 ms, open 114.0 ms (6.8 cyc), 3.7 cyc slower', () => {
    const r = simulate(rstp, { linkDown: { R1: 0 } })
    expect(r.outcome.verdict).toBe('late')
    expect(r.outcome.deliveredBy.sq).toBe(5)
    expect(fmtTime(tripFrames(r).find(f => f.pdu.stNum === 2 && f.pdu.sqNum === 5).sendT)).toBe('79.7 ms')
    expect(fmtDur(r.outcome.transferT)).toBe('64.0 ms')
    expect(fmtProt(r.outcome.openT, 60)).toBe('114.0 ms (6.8 cyc)')
    expect(((r.outcome.openT - 0.052) * 60).toFixed(1)).toBe('3.7')
    expect(r.events.filter(e => e.kind === 'rstp').map(e => Math.round(e.t * 1000))).toEqual([0, 50])
  })
  it('R1 failing 2 s before is harmless; PB1 itself failing loses the trip', () => {
    expect(fmtProt(simulate(rstp, { linkDown: { R1: -2 } }).outcome.openT, 60)).toBe('52.0 ms (3.1 cyc)')
    expect(simulate(rstp, { switchDown: { PB1: 0 } }).outcome.verdict).toBe('notDelivered')
  })
  it('PRP with LAN A failing at the fault: nothing lost, 2.03 ms', () => {
    const prp = withFeatures('redundancy')
    expect(fmtDur(simulate(prp, { switchDown: { PBA: 0 } }).outcome.transferT)).toBe('2.03 ms')
  })
})

describe('Sampled Values', () => {
  const sv = withFeatures('sampledValues')
  it('a merging unit per line bay on the process bus; the relay subscribes', () => {
    expect(sv.ieds.find(d => d.id === 'MU-AB').kind).toBe('mu')
    expect(sv.links.find(l => l.a === 'MU-AB').b).toBe('PB:5')
    expect(sv.svSubs).toEqual([{ id: '21-AB.SV', ied: '21-AB', sv: 'AB.SV', use: 'measure' }])
    expect(sv.svcbs[0].appid).toBeGreaterThanOrEqual(0x4000)
    expect(withFeatures('sampledValues', 'secondBay').svSubs.map(s => s.ied)).toEqual(['21-AB', '21-AX'])
    expect(withFeatures('sampledValues', 'redundancy').links.filter(l => l.a.startsWith('MU-AB')).map(l => l.b)).toEqual(['PBA:5', 'PBB:5'])
  })
  it('4800 samples a second at 60 Hz; smpCnt 0 at the fault, 80 one cycle later, restarting each second', () => {
    expect(svRate(60)).toBe(4800)
    expect(smpCntAt(0)).toBe(0)
    expect(smpCntAt(1 / 60)).toBe(80)
    expect(smpCntAt(1.0)).toBe(0)
    expect(smpCntAt(0.9999)).toBe(4799)
  })
  it('synthesized values: balanced (IN = 0), load 400 A and fault 8 kA peaks, nothing after clearing', () => {
    const peak = (st, ctx) => Math.max(...Array.from({ length: 80 }, (_, k) => Math.abs(instantValues(st + k / 4800, ctx).IA)))
    expect(Math.abs(instantValues(-0.01, {}).IN)).toBeLessThan(1e-6)
    expect(peak(-0.05, {})).toBeCloseTo(PHASORS.prefault.I * Math.SQRT2, -1)
    expect(peak(0.01, {})).toBeCloseTo(PHASORS.fault.I * Math.SQRT2, -2)
    expect(peak(0.2, { clearT: 0.052 })).toBe(0)
    const fz = sampleAt(0.03, { arriving: true, frozenAt: 0.005, invalid: false, synch: 2 }, {})
    expect(fz.frozen).toBe(true)
    expect(fz.smpCnt).toBe(smpCntAt(0.005))
  })
  it('normal: the relay trips at 16.7 ms on the samples, breaker open 52.0 ms; feature off changes nothing', () => {
    const r = simulate(sv, {})
    expect(fmtProt(r.outcome.tripT, 60)).toBe('16.7 ms (1.0 cyc)')
    expect(fmtProt(r.outcome.openT, 60)).toBe('52.0 ms (3.1 cyc)')
    expect(stationConfig(defaultConfig()).svSubs).toBeUndefined()
  })
  it('stream stops, freezes or goes invalid 5 ms after the fault: SV alarm at 6.00 ms (or at once), no trip', () => {
    for (const kind of ['stop', 'freeze', 'invalid']) {
      const r = simulate(sv, { svFault: { 'AB.SV': { kind, at: 0.005 } } })
      expect(r.outcome.verdict, kind).toBe('noTrip')
      const lost = r.events.find(e => e.kind === 'svLost')
      expect(fmtTime(lost.t), kind).toBe(kind === 'invalid' ? '5.00 ms' : '6.00 ms')
      expect(r.outcome.notes.some(n => /No alarm warned/.test(n.text))).toBe(false)
    }
  })
  it('MU link down 2 s before: standing SV alarm before the fault, no trip', () => {
    const r = simulate(sv, { linkDown: { M1: -2.0 } })
    expect(r.outcome.verdict).toBe('noTrip')
    expect(r.events.find(e => e.kind === 'svLost').t).toBeLessThan(0)
  })
  it('time sync lost: alarm, but the one-merging-unit relay still trips at 16.7 ms', () => {
    const r = simulate(sv, { svFault: { 'AB.SV': { kind: 'sync', at: -1.0 } } })
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtProt(r.outcome.tripT, 60)).toBe('16.7 ms (1.0 cyc)')
    expect(r.events.some(e => e.kind === 'svSync')).toBe(true)
    expect(r.events.at(-1).state.sv['21-AB.SV'].synch).toBe(0)
  })
  it('RSTP ring link fails at the fault: no samples for 50 ms, trip at 66.7 ms (4.0 cyc), open 102.0 ms; PRP loses nothing', () => {
    const c = defaultConfig(); c.features.sampledValues = true; c.features.redundancy = true; c.network.redundancy = 'rstp'
    const r = simulate(stationConfig(c), { linkDown: { R1: 0 } })
    expect(fmtProt(r.outcome.tripT, 60)).toBe('66.7 ms (4.0 cyc)')
    expect(fmtProt(r.outcome.openT, 60)).toBe('102.0 ms (6.1 cyc)')
    const p = simulate(withFeatures('sampledValues', 'redundancy'), { switchDown: { PBA: 0 } })
    expect(fmtProt(p.outcome.tripT, 60)).toBe('16.7 ms (1.0 cyc)')
  })
})

describe('slice 4: transformer bay and bus differential', () => {
  const st = fault => { const c = defaultConfig(); c.features.transformerBay = true; c.script.faultLine = fault; return stationConfig(c) }
  it('brings the second bay and SV; 87-AT with HV and LV merging units, 87B-A on all three bays', () => {
    const c = st('BUSA')
    expect(c.features.secondBay && c.features.sampledValues).toBe(true)
    expect(c.svSubs.filter(x => x.ied === '87B-A').map(x => x.sv)).toEqual(['AB.SV', 'AX.SV', 'AT.SV'])
    expect(c.svSubs.filter(x => x.ied === '87-AT').map(x => x.sv)).toEqual(['AT.SV', 'ATL.SV'])
    expect(c.subscriptions.filter(x => x.gocb === 'BUS.Trip').map(x => x.ied)).toEqual(['52-AB', '52-AX', '52-AT'])
  })
  it('bus fault: 87B-A trips at 16.7 ms, one GOOSE opens all three breakers at 52.0 ms; 21-AB stays quiet', () => {
    const r = simulate(st('BUSA'), {})
    expect(r.outcome.verdict).toBe('delivered')
    expect(fmtProt(r.outcome.tripT, 60)).toBe('16.7 ms (1.0 cyc)')
    expect(r.outcome.bfOpens.map(o => fmtProt(o.t, 60))).toEqual(Array(3).fill('52.0 ms (3.1 cyc)'))
    expect(fmtDur(r.outcome.transferT)).toBe('2.03 ms')
    expect(r.events.some(e => e.kind === 'trip' && e.dev === '21-AB')).toBe(false)
  })
  it('line fault: 87B-A and 87-AT stay quiet; transformer fault: 87-AT trips 52-AT only', () => {
    const l = simulate(st('AB'), {})
    expect(l.events.filter(e => e.kind === 'trip').map(e => e.dev)).toEqual(['21-AB'])
    const x = simulate(st('XFMRAT'), {})
    expect(x.events.filter(e => e.kind === 'trip').map(e => e.dev)).toEqual(['87-AT'])
    expect(x.events.filter(e => e.kind === 'open').map(e => e.dev)).toEqual(['52-AT'])
    expect(fmtProt(x.outcome.openT, 60)).toBe('52.0 ms (3.1 cyc)')
  })
  it('one merging unit loses sync: 87B-A blocks (bus fault not cleared), 21-AB still trips for a line fault', () => {
    const sc = { svFault: { 'AX.SV': { kind: 'sync', at: -1.0 } } }
    const r = simulate(st('BUSA'), sc)
    expect(r.outcome.verdict).toBe('noTrip')
    expect(r.events.find(e => e.kind === 'noTrip').text).toMatch(/not on a common clock/)
    expect(simulate(st('AB'), sc).outcome.verdict).toBe('delivered')
  })
  it('LV merging unit stopped 2 s before: 87-AT blocked; restored, it trips', () => {
    expect(simulate(st('XFMRAT'), { svFault: { 'ATL.SV': { kind: 'stop', at: -2.0 } } }).outcome.verdict).toBe('noTrip')
  })
  it('breaker failure on line A–B now opens 52-AX and 52-AT, both at 185.4 ms', () => {
    const r = simulate(st('AB'), { breakerStuck: ['52-AB'] })
    expect(r.outcome.verdict).toBe('clearedByBF')
    expect(r.outcome.bfOpens.map(o => o.dev)).toEqual(['52-AX', '52-AT'])
    expect(r.outcome.bfOpens.map(o => fmtProt(o.t, 60))).toEqual(['185.4 ms (11.1 cyc)', '185.4 ms (11.1 cyc)'])
  })
  it('without the transformer bay, a bus or transformer fault falls back to line A–B', () => {
    const c = defaultConfig(); c.script.faultLine = 'BUSA'
    expect(simulate(stationConfig(c), {}).outcome.verdict).toBe('delivered')
  })
  it('works with PRP and with RSTP', () => {
    const c = defaultConfig(); c.features.transformerBay = true; c.features.redundancy = true; c.script.faultLine = 'BUSA'
    expect(simulate(stationConfig(c), { switchDown: { PBA: 0 } }).outcome.verdict).toBe('delivered')
    c.network.redundancy = 'rstp'
    expect(simulate(stationConfig(c), {}).outcome.verdict).toBe('delivered')
  })
})
