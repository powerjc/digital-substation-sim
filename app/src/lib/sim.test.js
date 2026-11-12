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

const run = (sc = {}, cfg = defaultConfig()) => simulate(cfg, sc)
const ev = (r, kind, dev) => r.events.find(e => e.kind === kind && (!dev || e.dev === dev))
const ms = s => Math.round(s * 1e5) / 100 // s → ms, 2 decimals
const tripFrames = r => r.frames.filter(f => f.gocb === 'AB.Trip')

describe('schema', () => {
  it('is at v3 and migrates a current config unchanged', () => {
    const c = defaultConfig()
    expect(c.version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(3)
    expect(migrateConfig(c)).toEqual(c)
    expect(migrateConfig(null)).toEqual(defaultConfig())
  })
  it('migrates a v1 config to v3: features, script, BF timer, then the station / process bus topology', () => {
    const v1 = defaultConfig()
    v1.version = 1
    delete v1.script
    delete v1.timing.bfCycles
    v1.features = { networkDetail: true }
    v1.ieds = v1.ieds.map(({ line, ...d }) => d)
    v1.switches = [{ id: 'SW1', label: 'Bay switch', ports: { 1: { vlans: [10] }, 2: { vlans: [10] } } }]
    v1.links = [{ id: 'L1', a: '21-AB', b: 'SW1:1' }, { id: 'L2', a: 'SW1:2', b: '52-AB' }]
    const m = migrateConfig(v1)
    expect(m.version).toBe(3)
    expect(m.switches.map(x => x.id)).toEqual(['PB', 'SB'])
    expect(m.features).toEqual({ networkDetail: true, testMode: false, secondBay: false })
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
