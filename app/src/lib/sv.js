// Sampled Values: the merging unit's stream as a function of time.
//
// The engine doesn't push 4800 frames a second through its event queue.
// It works out *when* the stream reaching a relay is good or bad (network
// path, merging-unit problems), and this module synthesizes any individual
// sample on demand for display: sample counter, sync flag, values, quality.
//
// Values come from hand-written phasors (prefault load, a three-phase fault,
// the line de-energized after the breaker opens), stepped between states:
// no DC offset, no transients. Primary amps and volts, illustrative.

export const SV_SAMPLES_PER_CYCLE = 80 // IEC 61869-9 / 9-2LE protection rate
export const svRate = freqHz => SV_SAMPLES_PER_CYCLE * freqHz // 4800 /s at 60 Hz

export const SV_CHANNELS = ['IA', 'IB', 'IC', 'IN', 'VA', 'VB', 'VC', 'VN']

// Illustrative system: 138 kV line, line-to-neutral 79.7 kV
const VLN = 79_700
export const PHASORS = {
  prefault: { I: 400, Iang: -20, V: VLN, Vang: 0 },   // load
  fault: { I: 8000, Iang: -80, V: 0.3 * VLN, Vang: 0 }, // bolted three-phase fault, close-in
  cleared: { I: 0, Iang: 0, V: VLN, Vang: 0 },          // breaker open: line CT carries nothing, bus VT healthy
}
const SHIFT = { A: 0, B: -120, C: 120 }

export function powerState(t, { faultT = 0, clearT = null } = {}) {
  if (t < faultT) return 'prefault'
  if (clearT !== null && t >= clearT) return 'cleared'
  return 'fault'
}

// Instantaneous values at time t (no sampling, no quantization)
export function instantValues(t, ctx, freqHz = 60) {
  const p = PHASORS[powerState(t, ctx)]
  const w = 2 * Math.PI * freqHz
  const v = {}
  for (const ph of ['A', 'B', 'C']) {
    const s = SHIFT[ph] * Math.PI / 180
    v[`I${ph}`] = Math.SQRT2 * p.I * Math.cos(w * t + s + p.Iang * Math.PI / 180)
    v[`V${ph}`] = Math.SQRT2 * p.V * Math.cos(w * t + s + p.Vang * Math.PI / 180)
  }
  v.IN = v.IA + v.IB + v.IC
  v.VN = v.VA + v.VB + v.VC
  return v
}

// Sample counter: synchronized streams restart at 0 on each second boundary
// (the same sample number means the same instant in every merging unit);
// an unsynchronized merging unit counts from wherever its own clock is.
export function smpCntAt(t, freqHz = 60, synched = true, offset = 1234) {
  const rate = svRate(freqHz)
  const k = Math.floor((t - Math.floor(t)) * rate + 1e-9)
  return synched ? k : (k + offset) % rate
}

// What a stream health segment says about the samples at time t.
// health: { arriving, frozenAt, invalid, synch } from the engine.
export function sampleAt(t, h, ctx, freqHz = 60) {
  const rate = svRate(freqHz)
  const tk = Math.floor(t * rate + 1e-9) / rate // the sample instant at or before t
  const tv = h.frozenAt !== null && h.frozenAt !== undefined && tk >= h.frozenAt ? Math.floor(h.frozenAt * rate) / rate : tk
  return {
    t: tk,
    smpCnt: smpCntAt(tv, freqHz, h.synch > 0),
    smpSynch: h.synch,
    values: instantValues(tv, ctx, freqHz),
    quality: h.invalid ? 'invalid' : 'good',
    arriving: h.arriving,
    frozen: tv !== tk,
  }
}

// MU problems a scenario can inject: { [svId]: { kind, at } }
export const SV_FAULTS = [
  { id: '', label: 'Normal' },
  { id: 'stop-quiet', kind: 'stop', at: -2.0, label: 'Stops sending 2 s before the fault' },
  { id: 'stop-fault', kind: 'stop', at: 0.005, label: 'Stops sending 5 ms after the fault' },
  { id: 'freeze-fault', kind: 'freeze', at: 0.005, label: 'Sample counter freezes 5 ms after the fault' },
  { id: 'invalid-fault', kind: 'invalid', at: 0.005, label: 'Quality goes invalid 5 ms after the fault' },
  { id: 'sync-quiet', kind: 'sync', at: -1.0, label: 'Loses time sync 1 s before the fault' },
]
