import { describe, it, expect } from 'vitest'
import { CHAPTERS, PARTS, SKIP_CHECK, builtChapters, chapterById, parseRich } from './foundations'
import { GLOSSARY, lookupTerm } from './glossary'
import { demoSend, queueWait, sampleTripFrame, MESSAGE_KINDS, SV_SAMPLES_PER_CYCLE, parseReference, LN_TABLE, publishSchedule, SUB_CASES, subscribePipeline, TEST_MATRIX } from './figures'
import { simulate } from './timeline'
import { defaultConfig } from './schema'
import { testHandling, DBPOS_BITS } from './goose'
import { SCL_FILES, sclExcerpt, WHERE_LIVES, COMMISSIONING_STEPS, MISSES, stampedSequence, phaseDeg, falseDiff, ILLUSTRATIVE_SLOPE, bestMaster, protectionUnderSync, OSCILLATORS, holdoverError, secondsTo } from './figures'
import { SUB_WRONG } from './scenario'
import { posFromAux, readAux, fanout, lockoutStep, SIGNAL_MATRIX, MATRIX_IEDS, virtualInputs } from './figures'
import { serializationS, isGroupMac, BROADCAST } from './network'
import { fmtDur } from './units'

const FIGURES = new Set(['wires', 'frame', 'switch', 'vlan', 'station', 'layers', 'kinds', 'name', 'lnTable', 'gocb', 'publish', 'subscribe', 'testMatrix', 'contactMap', 'fanout', 'dryContacts', 'lockout', 'matrix', 'scl', 'whereLives', 'commissioning', 'clockOffset', 'phase', 'clocks', 'sync', 'holdover', null])
const PANELS = new Set(['bay', 'timing', 'frames', 'decoded', 'outcome'])

describe('foundations content', () => {
  it('every chapter belongs to a part; ids are unique', () => {
    expect(new Set(CHAPTERS.map(c => c.id)).size).toBe(CHAPTERS.length)
    for (const c of CHAPTERS) expect(PARTS.some(p => p.id === c.part)).toBe(true)
  })
  it('built chapters are complete and their figures and simulator links exist', () => {
    for (const c of builtChapters()) {
      expect(c.copper && c.key && c.body.length).toBeTruthy()
      for (const f of [c.figure].flat()) expect(FIGURES.has(f), `${c.id}: ${f}`).toBe(true)
      if (c.sim) expect(PANELS.has(c.sim.panel)).toBe(true)
    }
  })
  it('every marked term is in the glossary', () => {
    for (const c of builtChapters()) {
      for (const p of [...c.body, c.copper]) {
        for (const piece of parseRich(p).filter(x => x.kind === 'term')) {
          expect(lookupTerm(piece.term), `${c.id}: ${piece.term}`).not.toBeNull()
        }
      }
    }
  })
  it('glossary chapters exist', () => {
    for (const [k, v] of Object.entries(GLOSSARY)) expect(chapterById(v.chapter), k).toBeTruthy()
  })
  it('no unparsed markup reaches the page', () => {
    for (const c of builtChapters()) {
      for (const p of [...c.body, c.copper, c.key]) {
        for (const piece of parseRich(p)) expect(piece.text, `${c.id}: ${p.slice(0, 40)}`).not.toMatch(/\{\{|\}\}|\*\*|`/)
      }
    }
  })
  it('the skip-ahead target is built', () => {
    expect(chapterById(SKIP_CHECK.skipTo).built).toBe(true)
  })
  it('parses terms and bold', () => {
    expect(parseRich('a {{switch}} and {{MAC addresses|addresses}} **now** `PTRC1`').map(x => x.kind)).toEqual(['text', 'term', 'text', 'term', 'text', 'bold', 'text', 'code'])
  })
})

describe('A2: frames', () => {
  it('trip frame is 140 bytes and takes 12.8 µs at 100 Mbit/s', () => {
    const f = sampleTripFrame()
    expect(f.length).toBe(140)
    expect(fmtDur(serializationS(f.length, 100))).toBe('12.8 µs')
  })
  it('group addresses have an odd first byte', () => {
    expect(isGroupMac('01-0C-CD-01-00-01')).toBe(true)
    expect(isGroupMac(BROADCAST)).toBe(true)
    expect(isGroupMac('02-00-00-AB-00-21')).toBe(false)
  })
})

describe('A3: switch forwarding', () => {
  const arrived = r => Object.entries(r.devices).filter(([, d]) => d.arrived).map(([k]) => k)
  const kept = r => Object.entries(r.devices).filter(([, d]) => d.kept).map(([k]) => k)
  it('unicast leaves through one port only', () => {
    const r = demoSend('unicast')
    expect(arrived(r)).toEqual(['D3'])
    expect(kept(r)).toEqual(['D3'])
  })
  it('broadcast reaches and is kept by everyone', () => {
    const r = demoSend('broadcast')
    expect(kept(r)).toEqual(['D2', 'D3', 'D4'])
  })
  it('multicast reaches every port; only subscribers keep it', () => {
    const r = demoSend('multicast')
    expect(arrived(r)).toEqual(['D2', 'D3', 'D4'])
    expect(kept(r)).toEqual(['D2', 'D4'])
    expect(r.devices.D3.why).toMatch(/discards/)
  })
  it('multicast filtering sends it only where it is wanted', () => {
    const r = demoSend('multicast', { filter: true })
    expect(arrived(r)).toEqual(['D2', 'D4'])
  })
})

describe('A4: VLANs and priority', () => {
  it('a port without the VLAN never delivers the frame', () => {
    const r = demoSend('multicast', { vlan10: { 2: false, 3: true, 4: true } })
    expect(r.devices.D2.arrived).toBe(false)
    expect(r.devices.D2.why).toMatch(/VLAN/)
    expect(r.devices.D4.kept).toBe(true)
  })
  it('behind ten full-size frames the trip waits 1.23 ms; with priority at most 123 µs', () => {
    expect(fmtDur(queueWait({ priority: false }))).toBe('1.23 ms')
    expect(Math.round(queueWait({ priority: true }) * 1e6)).toBe(123)
  })
})

describe('B1: three kinds of message', () => {
  it('SV: 80 samples per cycle is 4800 per second at 60 Hz', () => {
    expect(SV_SAMPLES_PER_CYCLE * defaultConfig().freqHz).toBe(4800)
    expect(MESSAGE_KINDS.find(k => k.id === 'sv').rate).toMatch('4800')
  })
})

describe('B2: names', () => {
  it('takes the trip reference apart', () => {
    const p = parseReference('LineProtAB', 'LineProtABPROT/PTRC1.Tr.general').filter(x => x.kind !== 'sep')
    expect(p.map(x => [x.kind, x.text])).toEqual([['ied', 'LineProtAB'], ['ld', 'PROT'], ['lnClass', 'PTRC'], ['lnInst', '1'], ['do', 'Tr'], ['da', 'general']])
  })
  it('the simulator uses the logical nodes the chapter names', () => {
    const lns = LN_TABLE.flatMap(r => r.ln.split(' / '))
    for (const ln of ['PDIS', 'XCBR', 'PTRC']) expect(lns).toContain(ln)
    const refs = defaultConfig().gocbs.flatMap(g => g.entries.map(e => e.ref))
    expect(refs).toContain('PROT/PTRC1.Tr.general')
    expect(refs).toContain('CTRL/XCBR1.Pos.stVal')
  })
})

describe('B3: values by position', () => {
  it('a frame carries one value per dataset entry and no names', () => {
    const f = sampleTripFrame()
    const g = defaultConfig().gocbs.find(x => x.id === 'AB.Trip')
    expect(f.pdu.numDatSetEntries).toBe(g.entries.length)
    expect(f.pdu.allData.map(d => d.value)).toEqual([true, { validity: 'good', test: false }])
  })
})

describe('B4: publishing', () => {
  it('the figure’s pattern is the simulator’s: gaps 2, 4, 8, 16 ms; TAL 4 ms first, 2000 ms on a heartbeat', () => {
    const sim = simulate(defaultConfig(), {}).frames.filter(f => f.gocb === 'AB.Trip' && f.pdu.stNum === 2)
    const t0 = sim[0].sendT
    // stNum 2 lasts until the trip resets (a new state), so compare over that window
    const fig = publishSchedule({ changes: [0], untilS: sim.at(-1).sendT - t0 })
    expect(fig.length).toBe(sim.length)
    fig.forEach((f, i) => {
      expect(f.t).toBeCloseTo(sim[i].sendT - t0, 9)
      expect(f.sq).toBe(sim[i].pdu.sqNum)
      expect(f.tal).toBe(sim[i].pdu.timeAllowedtoLive)
    })
    expect(fig[0].tal).toBe(4)
    expect(publishSchedule({ changes: [0], untilS: 3 }).at(-1).tal).toBe(2000)
    const q = simulate(defaultConfig(), {}).frames.filter(f => f.gocb === 'AB.Trip' && f.sendT < 0)
    expect(q.every(f => f.pdu.timeAllowedtoLive === 2000)).toBe(true)
  })
  it('a second change restarts the burst with stNum one higher', () => {
    const f = publishSchedule({ changes: [0, 0.04], untilS: 0.07 })
    const second = f.find(x => x.st === 3)
    expect(second.t).toBeCloseTo(0.04, 9)
    expect(second.sq).toBe(0)
    expect(f.filter(x => x.st === 2).every(x => x.t < 0.04)).toBe(true)
  })
})

describe('B5: subscriber checks', () => {
  const at = (c, id) => subscribePipeline(c).steps.find(s => s.id === id).result
  it('covers every case', () => {
    expect(SUB_CASES.map(c => subscribePipeline(c.id).outcome.level)).toEqual(['good', 'info', 'bad', 'bad', 'bad', 'warn', 'bad'])
  })
  it('fails each case at the right step', () => {
    expect(at('appid', 'filter')).toBe('fail')
    expect(at('gocbRef', 'identity')).toBe('fail')
    expect(at('confRev', 'identity')).toBe('fail')
    expect(at('test', 'test')).toBe('fail')
    expect(at('test', 'supervision')).toBe('pass')
    expect(at('silence', 'supervision')).toBe('fail')
    expect(subscribePipeline('new').steps.every(s => s.result === 'pass')).toBe(true)
  })
})

describe('B6: test data', () => {
  it('normal-mode subscribers treat test data as invalid; test-mode subscribers use it', () => {
    expect(TEST_MATRIX.map(r => r.cells.map(c => c.use))).toEqual([[true, true], [false, true]])
  })
  it('the engine applies the same rule', () => {
    const f = structuredClone(sampleTripFrame())
    f.pdu.allData[1].value.test = true
    expect(testHandling({ mode: 'on' }, f).use).toBe(false)
    expect(testHandling({ mode: 'test' }, f).use).toBe(true)
  })
})

describe('C3: 52a / 52b', () => {
  it('maps the contacts onto the double point the engine publishes', () => {
    expect(posFromAux(true, false)).toBe('on')
    expect(posFromAux(false, true)).toBe('off')
    expect(posFromAux(false, false)).toBe('intermediate')
    expect(posFromAux(true, true)).toBe('bad')
    expect(['on', 'off', 'intermediate', 'bad'].map(p => DBPOS_BITS[p])).toEqual(['10', '01', '00', '11'])
  })
  it('a broken 52b wire shows as a lasting intermediate state, never as a wrong position', () => {
    expect(readAux('closed', { b52WireBroken: true }).pos).toBe('on')
    expect(readAux('open', { b52WireBroken: true }).pos).toBe('intermediate')
    expect(readAux('open').pos).toBe('off')
  })
})

describe('C2: fan-out', () => {
  const lost = r => r.dests.filter(d => !d.delivered).map(d => d.id)
  const alarmed = r => r.dests.filter(d => d.alarmed).map(d => d.id)
  it('a common failure stops every destination; only the digital version alarms for each', () => {
    expect(lost(fanout({ model: 'copper', fail: 'common' }))).toHaveLength(4)
    expect(alarmed(fanout({ model: 'copper', fail: 'common' }))).toEqual([])
    expect(alarmed(fanout({ model: 'digital', fail: 'common' }))).toHaveLength(4)
  })
  it('one broken path: copper alarms only on supervised circuits', () => {
    expect(lost(fanout({ model: 'copper', fail: 'one' }))).toEqual(['bfi'])
    expect(alarmed(fanout({ model: 'copper', fail: 'one' }))).toEqual([])
    expect(alarmed(fanout({ model: 'digital', fail: 'one' }))).toEqual(['bfi'])
  })
  it('a fifth destination needs a new aux relay in copper, only a subscription in digital', () => {
    expect(fanout({ model: 'copper', n: 5 }).extra).toMatch(/second aux relay/)
    expect(fanout({ model: 'digital', n: 5 }).extra).toMatch(/publisher is unchanged/)
  })
})

describe('C4: lockout', () => {
  const run = (actions, opts) => actions.reduce((s, a) => lockoutStep(s, a, opts), { lo: false, closed: true })
  it('blocks closing until reset', () => {
    expect(run(['trip', 'close'], {}).closed).toBe(false)
    expect(run(['trip', 'reset', 'close'], {}).closed).toBe(true)
  })
  it('an IED latch not stored is lost on restart; the 86 and a stored latch are not', () => {
    expect(run(['trip', 'restart', 'close'], { model: 'digital', retained: false }).closed).toBe(true)
    expect(run(['trip', 'restart', 'close'], { model: 'digital', retained: true }).closed).toBe(false)
    expect(run(['trip', 'restart', 'close'], { model: 'copper' }).closed).toBe(false)
  })
})

describe('C5: signal matrix', () => {
  it('agrees with the bay simulator’s subscriptions', () => {
    const cfg = defaultConfig()
    for (const sub of cfg.subscriptions) {
      const g = cfg.gocbs.find(x => x.id === sub.gocb)
      const row = SIGNAL_MATRIX.find(r => r.id === g.id)
      expect(row.pub).toBe(g.ied)
      expect(row.subs[sub.ied]).toBeTruthy()
    }
  })
  it('every publisher and subscriber is a station IED; nobody subscribes to itself', () => {
    for (const r of SIGNAL_MATRIX) {
      expect(MATRIX_IEDS).toContain(r.pub)
      for (const d of Object.keys(r.subs)) { expect(MATRIX_IEDS).toContain(d); expect(d).not.toBe(r.pub) }
    }
  })
  it('breaker failure clears the rest of bus A', () => {
    expect(Object.keys(SIGNAL_MATRIX.find(r => r.id === 'AB.BF').subs).sort()).toEqual(['52-AT', '52-AX'])
    expect(virtualInputs('52-AB').map(v => v.signal)).toEqual(['Line A–B trip', 'Breaker failure, 52-AX'])
  })
})

describe('D1: SCL', () => {
  it('excerpts carry the simulator’s own values in SCL formats', () => {
    const scd = sclExcerpt('scd')
    expect(scd).toContain('<P type="APPID">0101</P>')
    expect(scd).toContain('<P type="VLAN-ID">00A</P>')
    expect(scd).toContain('<P type="MAC-Address">01-0C-CD-01-00-01</P>')
    expect(scd).toContain('<MinTime unit="s" multiplier="m">2</MinTime>')
    expect(scd).toContain('<MaxTime unit="s" multiplier="m">1000</MaxTime>')
    expect(scd).toContain('<GSEControl name="Trip" datSet="DS_Trip" appID="AB_Trip" confRev="1"')
    expect(scd).toContain('<FCDA ldInst="PROT" lnClass="PTRC" lnInst="1" doName="Tr" daName="general" fc="ST"/>')
    expect(scd).toContain('srcCBName="Trip"')
    for (const f of SCL_FILES) expect(sclExcerpt(f.id), f.id).toBeTruthy()
  })
})

describe('D2 / D3: values and misses', () => {
  it('every subscription error the simulator can inject is a miss commissioning catches', () => {
    for (const k of Object.keys(SUB_WRONG)) {
      const m = MISSES.find(x => x.id === k)
      expect(m, k).toBeTruthy()
      expect(m.caughtBy.length).toBeGreaterThan(0)
    }
    for (const m of MISSES) for (const st of m.caughtBy) expect(COMMISSIONING_STEPS.some(s => s.id === st)).toBe(true)
  })
  it('an IED left in test mode is caught only by the restore step', () => {
    expect(MISSES.find(m => m.id === 'testLeft').caughtBy).toEqual(['restore'])
  })
  it('“Break it” scenarios really break the trip in the simulator', () => {
    for (const r of WHERE_LIVES.filter(x => x.miss)) {
      const m = MISSES.find(x => x.id === r.miss)
      expect(simulate(defaultConfig(), m.scenario).outcome.verdict, r.value).toBe('notDelivered')
    }
    expect(simulate(defaultConfig(), MISSES.find(m => m.id === 'link').scenario).outcome.verdict).toBe('notDelivered')
  })
})

describe('E1: timestamps', () => {
  it('clocks that agree give the true order; 5 ms behind puts the coil before the trip', () => {
    expect(stampedSequence(0).misordered).toBe(false)
    const r = stampedSequence(-0.005)
    expect(r.misordered).toBe(true)
    expect(r.rows[0].label).toMatch(/trip coil/)
  })
})

describe('E2: phase', () => {
  it('21.6° per ms and 0.0216° per µs at 60 Hz', () => {
    expect(phaseDeg(1e-3)).toBeCloseTo(21.6, 9)
    expect(phaseDeg(1e-6)).toBeCloseTo(0.0216, 9)
  })
  it('false differential: 0.37·I at 1 ms (above a 30 % slope), under 0.4 % at 10 µs', () => {
    expect(falseDiff(1e-3).toFixed(2)).toBe('0.37')
    expect(falseDiff(1e-3)).toBeGreaterThan(ILLUSTRATIVE_SLOPE)
    expect(falseDiff(1e-5)).toBeLessThan(0.004)
  })
})

describe('E3: grandmaster', () => {
  const C = (id, p2, state = 'locked', failed = false) => ({ id, priority1: 128, priority2: p2, state, failed })
  it('the better clock wins; GPS loss or failure moves the role', () => {
    expect(bestMaster([C('GM1', 1), C('GM2', 2)])).toBe('GM1')
    expect(bestMaster([C('GM1', 1, 'holdover'), C('GM2', 2)])).toBe('GM2')
    expect(bestMaster([C('GM1', 1, 'locked', true), C('GM2', 2)])).toBe('GM2')
    expect(bestMaster([C('GM1', 1, 'holdover'), C('GM2', 2, 'holdover')])).toBe('GM1')
    expect(bestMaster([C('GM1', 1, 'locked', true), C('GM2', 2, 'locked', true)])).toBeNull()
  })
})

describe('E4: sync and protection', () => {
  const st = s => Object.fromEntries(protectionUnderSync(s).map(f => [f.id, f.ok]))
  it('multi-stream functions block on bad or mixed sync; single-stream ones carry on', () => {
    expect(st({ AX: 2, AB: 2, AT: 2 })).toEqual({ '87B': true, '21AB': true, '51AT': true })
    expect(st({ AX: 1, AB: 1, AT: 1 })['87B']).toBe(true)
    expect(st({ AX: 2, AB: 0, AT: 2 })).toEqual({ '87B': false, '21AB': true, '51AT': true })
    expect(st({ AX: 2, AB: 1, AT: 2 })['87B']).toBe(false)
  })
})

describe('E5: holdover', () => {
  it('1 ppm is 1 µs per second; crystal 1 s, OCXO 100 s, rubidium about 2.8 h to 1 µs', () => {
    expect(holdoverError(1, 1)).toBeCloseTo(1e-6, 15)
    const t = Object.fromEntries(OSCILLATORS.map(o => [o.id, secondsTo(o.ppm, 1e-6)]))
    expect(t.xo).toBeCloseTo(1, 6)
    expect(t.ocxo).toBeCloseTo(100, 6)
    expect((t.rb / 3600).toFixed(1)).toBe('2.8')
  })
})
