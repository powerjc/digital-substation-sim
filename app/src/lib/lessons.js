// Lesson content (data). Every number quoted here is checked by
// sim.test.js; when a test disagrees with the text, fix the text.
//
// { id, track, title, zoom: 'trip' | 'heartbeats', setup?(cfg), scenario,
//   intro, watch[], tryIt[], takeaway, expect: { verdict } }

export const TRACKS = ['GOOSE basics']

export const LESSONS = [
  {
    id: 'trip-message',
    track: 'GOOSE basics',
    title: 'A trip is a message',
    zoom: 'trip',
    scenario: {},
    intro: 'Line relay 21-AB trips 16.7 ms (1 cycle) after a fault on line A–B. There is no trip wire: the trip travels to breaker IED 52-AB as a GOOSE message through the bay switch.',
    watch: [
      'At the trip, stNum steps from 1 to 2 and sqNum restarts at 0. Repeats follow 2, 4, 8, 16 ms… apart, each carrying a timeAllowedtoLive (TAL) of twice the gap to the next frame.',
      '52-AB acts on the first frame (stNum 2, sqNum 0) and energizes the trip coil at 18.7 ms, 2.03 ms after the trip. The repeats change nothing.',
      'The breaker answers with its own GOOSE: Position goes intermediate, then open. 21-AB sees it open at 59.1 ms.',
    ],
    tryIt: [
      'Step frame by frame (Frame ▶) and tap each frame to decode it. Compare sqNum and TAL across the burst.',
      'Switch to the Heartbeats view: before the fault each publisher repeats its unchanged state once a second, and after the trip the burst backs off to that again.',
      'Turn on ⚙ Network detail: the network takes about 31 µs of the 2.03 ms. The IEDs’ own processing takes the rest.',
    ],
    takeaway: 'GOOSE has no acknowledgement. Reliability comes from repetition, and a subscriber knows its publisher is alive only because frames keep arriving within TAL. The relay learns the breaker opened from a second GOOSE going the other way.',
    expect: { verdict: 'delivered' },
  },
  {
    id: 'never-heard',
    track: 'GOOSE basics',
    title: 'The relay tripped, but the breaker never heard it',
    zoom: 'trip',
    scenario: { subWrong: { '52-AB.Trip': 'appid' } },
    intro: 'Same fault, same trip. But 52-AB’s subscription was engineered with the wrong APPID: a classic commissioning miss.',
    watch: [
      'Every Trip frame reaches 52-AB and is ignored: it matches nothing 52-AB subscribes to. Tap a frame to compare expected and received.',
      'The trip coil never energizes. The breaker stays closed.',
      '52-AB’s Trip subscription has shown NO MSG since before the run started.',
    ],
    tryIt: [
      'Tap 52-AB in the station view and pick a wrong gocbRef, or the re-issued publisher (confRev 2). Now the frames are rejected and the alarm says why (CONFIG).',
      'Set the subscription back to correct and break the switch instead: tap SW1 and take port 2 out of VLAN 10. The frames never reach 52-AB, and 21-AB loses the Position GOOSE too.',
    ],
    takeaway: 'The frames were on the wire the whole time. A wrong subscription doesn’t wait for a fault: its alarm stands from the day the configuration was loaded. A wrong APPID or VLAN shows only “no message”; a confRev or name mismatch says what is wrong. Commissioning tests and following up alarms catch it. The fault doesn’t.',
    expect: { verdict: 'notDelivered' },
  },
  {
    id: 'lost-frame',
    track: 'GOOSE basics',
    title: 'One lost frame, and a dead link',
    zoom: 'trip',
    scenario: { drops: [{ link: 'L1', gocb: 'AB.Trip', st: 2, sq: 0 }] },
    intro: 'The first Trip frame after the trip is lost on link L1, between 21-AB and the switch.',
    watch: [
      'Frame stNum 2, sqNum 0 dies on L1. The first retransmission (sqNum 1) follows 2 ms later, and 52-AB acts on it.',
      'Transfer time grows from 2.03 ms to 4.03 ms: beyond the 3 ms class for trip messages, though still only about a quarter of a cycle.',
    ],
    tryIt: [
      'Tap link L1 and choose “Fails 2 s before the fault”, then the Heartbeats view. 52-AB’s Trip subscription goes LOST at −600 ms, 1.4 s after the link failed, when the TAL (2000 ms) of the last heartbeat runs out. The trip is never delivered.',
      'Choose “Fails at the fault”: nothing warns before the trip, the trip is lost, and the alarm comes at 1.400 s, long after the fault should have been cleared.',
    ],
    takeaway: 'Fast repeats after a change make one lost frame cheap. Supervision tells you a link is gone within about two heartbeats, but it is an alarm, not a fix. Redundancy (PRP/HSR, a later slice) is the fix.',
    expect: { verdict: 'late' },
  },
]
