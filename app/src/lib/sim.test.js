import { describe, it, expect } from 'vitest'
import { defaultConfig, migrateConfig, SCHEMA_VERSION, PROFILES, TRIP_CLASS } from './schema'
import { simulate, stateAt, START_T } from './timeline'
import { matchFrame, sequenceCheck, testHandling, frameLength } from './goose'
import { serializationS } from './network'
import { applyScenario, countFailures, EMPTY_SCENARIO } from './scenario'
import { isActive } from './features'
import { fmtTime, fmtDur, fmtProt } from './units'
import { LESSONS } from './lessons'

const run = (sc = {}, cfg = defaultConfig()) => simulate(cfg, sc)
const ev = (r, kind, dev) => r.events.find(e => e.kind === kind && (!dev || e.dev === dev))
const ms = s => Math.round(s * 1e5) / 100 // s → ms, 2 decimals
const tripFrames = r => r.frames.filter(f => f.gocb === 'AB.Trip')

describe('schema', () => {
  it('starts at v1 and migrates a v1 config unchanged', () => {
    const c = defaultConfig()
    expect(c.version).toBe(SCHEMA_VERSION)
    expect(migrateConfig(c)).toEqual(c)
    expect(migrateConfig(null)).toEqual(defaultConfig())
  })
  it('has every feature off by default', () => {
    const c = defaultConfig()
    expect(Object.values(c.features).every(v => !v)).toBe(true)
    expect(isActive(c, 'networkDetail')).toBe(false)
  })
  it('names no device in the engine: the bay is data', () => {
    const c = defaultConfig()
    expect(c.ieds.map(d => d.id)).toEqual(['21-AB', '52-AB'])
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

  it('lesson 2: port 2 out of VLAN 10 → dropped at the switch, both directions lost', () => {
    const r = run({ vlanMissing: [{ sw: 'SW1', port: 2, vlan: 10 }] })
    expect(r.outcome.verdict).toBe('notDelivered')
    expect(tripFrames(r)[0].rx['52-AB.Trip'].reason).toMatch(/SW1 port 2 is not in VLAN 10/)
    expect(r.events[0].state.subs['52-AB.Trip'].status).toBe('noMsg')
    expect(r.events[0].state.subs['21-AB.Pos'].status).toBe('noMsg')
  })
})

describe('lessons', () => {
  for (const l of LESSONS) {
    it(`${l.title}: ${l.expect.verdict}`, () => {
      const cfg = defaultConfig()
      l.setup?.(cfg)
      expect(simulate(cfg, l.scenario).outcome.verdict).toBe(l.expect.verdict)
    })
  }
})
