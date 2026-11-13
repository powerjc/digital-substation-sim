// "Reading the simulator screen": a step-through that spotlights one panel at
// a time. Data, like lessons. action: { time } sets the playback time
// ('end' = end of the view); { select: 'trip' } selects the first trip frame.

export const TOUR = [
  {
    panel: 'bay', title: 'The bay',
    text: 'From the control house to the yard (left to right; top to bottom on a phone): the gateway on the station bus SB; the line relay 21-AB, with a port on each bus; the process bus PB; and the breaker IED 52-AB. Each box shows what the device knows right now: the relay’s trip and the breaker position it has heard about, the breaker IED’s trip coil and contacts, and each subscription’s status (OK, NO MSG, LOST, CONFIG). Tap a box or a link to break it.',
    chapter: 'A1', action: { time: -0.005 },
  },
  {
    panel: 'timing', title: 'The timing chart',
    text: 'Time runs left to right, as on a logic analyzer: digital traces for the trip, the coil and the breaker; one lane of ticks per GOOSE message (each tick a frame, labelled stNum/sqNum); and a band per subscription. Play, Step (next event) and Frame (next frame) move through the run. “Around the trip” shows milliseconds, “Heartbeats” the quiet seconds before.',
    chapter: 'B4', action: { time: 0.03 },
  },
  {
    panel: 'frames', title: 'Frames on the wire',
    text: 'Every frame sent in this view, in order: its stNum/sqNum, its TAL, and what each subscriber did with it: new state, repeat, ignored, rejected, lost, or not used because it was flagged test.',
    chapter: 'B5', action: { time: 0.06 },
  },
  {
    panel: 'decoded', title: 'The decoded frame',
    text: 'Tap any frame to take it apart, as a protocol analyzer does: Ethernet and VLAN header, GOOSE header, the PDU fields and the data values, each with one line of explanation. For a frame a subscriber ignored or rejected, what it expected is shown next to what it got. (On a phone this opens at the bottom of the screen.)',
    chapter: 'A2', action: { select: 'trip' }, phonePanel: 'frames',
  },
  {
    panel: 'outcome', title: 'The outcome',
    text: 'At the end of the run: when the trip reached the breaker IED and the transfer time against the 3 ms class (the bar splits it into publish, network and subscribe), when the breaker opened, and which alarms warned, and when.',
    chapter: 'E1', action: { time: 'end' },
  },
  {
    panel: 'events', title: 'Sequence of events',
    text: 'The same run as a list of device events with their times: trip, publish, accept, coil, breaker open, subscription alarms. Tap an event to jump the chart to it.',
    chapter: 'E1',
  },
  {
    panel: 'header', title: 'Lessons, settings and Foundations',
    text: 'Lessons set up a situation and tell you what to watch for. ⚙ adds more when you want it: network detail, test mode, more bays, redundancy, Sampled Values, time sync, and MMS to the gateway. Foundations explains everything on this screen from the copper wiring up; the small ? beside a panel title opens the matching chapter.',
    chapter: null,
  },
]
