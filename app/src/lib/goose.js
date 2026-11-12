// GOOSE: building frames, estimating their encoded length, and the checks a
// subscriber makes on each arriving frame (IEC 61850-8-1 behaviour as taught
// here; values are illustrative where the standard leaves them open).

import { ETHERTYPE_GOOSE } from './schema'

// Double-point position (Dbpos) as carried in a GOOSE: two bits
export const DBPOS_BITS = { intermediate: '00', off: '01', on: '10', bad: '11' }

const GOOD = { validity: 'good', test: false }

// Data values for a control block's dataset from the publishing IED's state
export function datasetValues(gocb, iedState, ied) {
  const test = ied.mode === 'test' || ied.mode === 'test/blocked' // mode hook (slice 1.1)
  return gocb.entries.map(e => {
    const v = iedState[e.signal]
    if (e.type === 'Quality') return { ref: e.ref, type: e.type, value: { ...GOOD, test } }
    return { ref: e.ref, type: e.type, value: v }
  })
}

// BER length of an unsigned integer value
const intLen = v => (v < 0x80 ? 1 : v < 0x8000 ? 2 : v < 0x800000 ? 3 : v < 0x80000000 ? 4 : 5)
const tlv = n => 2 + n // tag + short length + value (all fields here are < 128 bytes)
const dataLen = d => (d.type === 'BOOLEAN' ? tlv(1) : d.type === 'Quality' ? tlv(3) : d.type === 'Dbpos' ? tlv(2) : tlv(4))

// Ethernet frame length in bytes (dst+src+VLAN tag+EtherType, GOOSE header,
// BER-encoded PDU, FCS). An estimate good to a few bytes.
export function frameLength(pdu) {
  const all = pdu.allData.reduce((s, d) => s + dataLen(d), 0)
  const fields = tlv(pdu.gocbRef.length) + tlv(intLen(pdu.timeAllowedtoLive)) + tlv(pdu.datSet.length) +
    tlv(pdu.goID.length) + tlv(8) + tlv(intLen(pdu.stNum)) + tlv(intLen(pdu.sqNum)) + tlv(1) +
    tlv(intLen(pdu.confRev)) + tlv(1) + tlv(intLen(pdu.numDatSetEntries)) + tlv(all)
  const pduLen = 1 + (fields > 255 ? 3 : fields > 127 ? 2 : 1) + fields
  const apduLen = 8 + pduLen // APPID, Length, Reserved 1, Reserved 2 + PDU
  return 6 + 6 + 4 + 2 + apduLen + 4
}

export function buildFrame({ id, gocb, ied, sendT, changeT, stNum, sqNum, tal, allData }) {
  const pdu = {
    gocbRef: gocb.gocbRef,
    timeAllowedtoLive: tal,
    datSet: gocb.datSet,
    goID: gocb.goID,
    t: changeT,
    stNum,
    sqNum,
    simulation: !!ied.lphdSim, // mode hook (slice 1.1)
    confRev: gocb.confRev,
    ndsCom: false,
    numDatSetEntries: allData.length,
    allData,
  }
  const frame = {
    id, gocb: gocb.id, pub: ied.id, sendT,
    dst: gocb.mac, src: ied.mac,
    vlan: { id: gocb.vlan.id, priority: gocb.vlan.priority, dei: 0 },
    ethertype: ETHERTYPE_GOOSE,
    appid: gocb.appid,
    pdu,
  }
  frame.length = frameLength(pdu)
  return frame
}

const hex4 = v => '0x' + v.toString(16).toUpperCase().padStart(4, '0')
export const fmtAppid = hex4

// Steps 1 and 2: does this subscription take the frame at all?
// → { fate: 'ok' | 'ignored' | 'rejected', reason, compare: [{ field, expected, received }] }
export function matchFrame(frame, sub) {
  const ex = sub.expect
  const filt = []
  if (frame.dst !== ex.mac) filt.push({ field: 'Destination MAC', expected: ex.mac, received: frame.dst })
  if (frame.appid !== ex.appid) filt.push({ field: 'APPID', expected: hex4(ex.appid), received: hex4(frame.appid) })
  if (filt.length) {
    return { fate: 'ignored', compare: filt,
      reason: `ignored: not a subscribed message (${filt.map(f => f.field).join(', ')} differs). No alarm names the cause` }
  }
  const id = []
  if (frame.pdu.gocbRef !== ex.gocbRef) id.push({ field: 'gocbRef', expected: ex.gocbRef, received: frame.pdu.gocbRef })
  if (frame.pdu.datSet !== ex.datSet) id.push({ field: 'datSet', expected: ex.datSet, received: frame.pdu.datSet })
  if (frame.pdu.confRev !== ex.confRev) id.push({ field: 'confRev', expected: ex.confRev, received: frame.pdu.confRev })
  if (id.length) {
    return { fate: 'rejected', compare: id,
      reason: `rejected: configuration mismatch (${id.map(f => f.field).join(', ')})` }
  }
  return { fate: 'ok', compare: [], reason: null }
}

// Step 3: sequence. → { kind: 'new' | 'repeat' | 'old', note }
export function sequenceCheck(subState, frame) {
  const { stNum, sqNum } = frame.pdu
  if (subState.lastSt === null) return { kind: 'new', note: null }
  if (stNum !== subState.lastSt) {
    if (stNum < subState.lastSt) return { kind: 'old', note: `stNum went back (${subState.lastSt} → ${stNum})` }
    const missed = stNum - subState.lastSt - 1
    return { kind: 'new', note: missed > 0 ? `${missed} state change(s) missed` : null }
  }
  if (sqNum <= subState.lastSq) return { kind: 'old', note: `duplicate or out of order (sqNum ${sqNum} after ${subState.lastSq})` }
  const missed = sqNum - subState.lastSq - 1
  return { kind: 'repeat', note: missed > 0 ? `${missed} retransmission(s) missed` : null }
}

// Step 4: test handling (IEC 61850-7-4 Annex A, as taught here): a subscriber
// whose behaviour is on / blocked treats test-flagged data as invalid; one in
// test or test/blocked uses it. Nothing in slice 1 sets a test flag, so the
// bay behaves as before; slice 1.1 adds the UI and the simulation flag
// (LPHD.Sim) handling.
export const isTestMode = mode => mode === 'test' || mode === 'test/blocked'

export function testDecision(dataTest, subscriberMode) {
  if (!dataTest) return { use: true, note: null }
  return isTestMode(subscriberMode)
    ? { use: true, note: 'test data accepted: this IED is in test mode too' }
    : { use: false, note: 'test data treated as invalid: this IED is in normal mode' }
}

export function testHandling(ied, frame) {
  const dataTest = frame.pdu.allData.some(d => d.type === 'Quality' && d.value.test)
  return testDecision(dataTest, ied.mode)
}
