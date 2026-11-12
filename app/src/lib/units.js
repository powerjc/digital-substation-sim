// Time display. Milliseconds everywhere; protection-relevant figures (fault →
// trip, transfer time, trip → breaker open, clearing) also in cycles.
// GOOSE intervals, TAL and network delays stay in ms / µs.

const MINUS = '−'
const sign = v => (v < 0 ? MINUS : '')

// Run time (s): seconds when far from the fault, ms near it
export function fmtTime(s) {
  const a = Math.abs(s)
  if (a >= 0.9995) return `${sign(s)}${a.toFixed(3)} s`
  return `${sign(s)}${(a * 1000).toFixed(a * 1000 < 10 ? 2 : 1)} ms`
}

// A duration (s), unit chosen by size
export function fmtDur(s) {
  const a = Math.abs(s)
  if (a < 1e-3) return `${(a * 1e6).toFixed(1)} µs`
  if (a < 1) return `${(a * 1000).toFixed(a < 0.01 ? 2 : 1)} ms`
  return `${a.toFixed(3)} s`
}

export const cycles = (s, freqHz) => s * freqHz

// Protection-relevant time: "16.7 ms (1.0 cyc)"
export function fmtProt(s, freqHz) {
  return `${fmtTime(s)} (${(s * freqHz).toFixed(1)} cyc)`
}

export function fmtProtDur(s, freqHz) {
  return `${fmtDur(s)} (${(s * freqHz).toFixed(2)} cyc)`
}
