# Digital Substation Simulator

An interactive, browser-based training simulator for the digital substation: how a protection trip travels as an IEC 61850 **GOOSE** message instead of over a wire, and what breaks when the network or its configuration is wrong.

Companion to the Line Protection Simulator, which answers "the relay tripped at 17 ms, and here is why". This one answers "and here is how that trip travelled over the network".

**Status:** in development. Bay simulator: GOOSE in one bay, plus (behind ⚙) test mode with a test set, a second bay with breaker failure, a redundant process bus (PRP or RSTP), Sampled Values, a transformer bay with transformer and bus differential, and time sync (PTP). Foundations: Parts A–E. See `SPEC.md`.

## What it shows

- **One bay** (line A–B) on a station bus and a process bus: line relay 21-AB with a port on each, breaker IED 52-AB (the bay's process interface unit) on the process bus, a gateway on the station bus. The relay publishes a Trip GOOSE; the breaker IED publishes its position back.
- **Timing chart** in the style of a logic analyzer: device signals, every frame on the wire (labelled stNum/sqNum and colored by what the subscriber did with it), and each subscription's supervision state. Two views: around the trip (ms) and heartbeats (s).
- **Decoded frames** in the style of a protocol analyzer, every field with a one-line explanation, and expected vs received values for a frame the subscriber ignored or rejected.
- **Failures to inject:** link down (fixed presets), one lost frame, a subscription engineered with the wrong APPID, gocbRef, dataset or confRev, a switch port missing the VLAN.
- **Outcome:** transfer time against the 3 ms class for trip messages (IEC 61850-5, TT6), breaker open time, and which alarms warned, and when.
- **Lessons:** *A trip is a message*, *The relay tripped, but the breaker never heard it*, *One lost frame, and a dead link*; *The relay was left in test*, *Left in simulation mode*; *Breaker failure: the neighbours clear it*, *A lost trip, saved by breaker failure*, *One switch, two bays*, *Right in one bay, missing in the other*; *Two networks: nothing lost*, *RSTP: “the network recovered in 50 ms”*; *The CT wiring is a stream*, *No samples, no protection*; *Bus differential: one message, every breaker*, *One clock lost, the whole bus unprotected*, *Transformer differential: both sides or nothing*; *No GPS, still one clock*, *The grandmaster fails: a gap with no differential*. A tour explains the screen.
- **⚙ options:** network detail; time sync (two PTP grandmasters: GPS loss, holdover, failover); transformer bay A–T with 87T and bus differential 87B (fault on the line, the bus or the transformer); Sampled Values (a merging unit per line bay; the relay measures from the stream); test mode (on / test / test/blocked per IED, simulation mode, and a test set publishing simulated GOOSE); a second bay (line A–X) with breaker failure, a stuck breaker and switch failures; a redundant process bus (PRP with LAN A and LAN B, or an RSTP ring).
- **Foundations:** 25 short chapters from the copper you know to the network (A), IEC 61850 messaging (B), virtual wiring in ANSI / IEEE terms (C), configuration and SCL (D), and time (E), each with a figure that runs the simulator's own engine; a 90-term glossary.

## Model notes and limits

- The fault and the relay's decision are **scripted** (trip 1 cycle after the fault); this simulator is about how signals travel, not why the relay tripped.
- Retransmission profile, IED stack times, switch latency and breaker timing are **illustrative**; IEC 61850-8-1 leaves the retransmission curve to the implementation.
- Deterministic: no random loss, jitter or background traffic. VLAN priority is shown and explained but has no effect without competing traffic.
- Sampled Values are synthesized from phasors (no DC offset or transients) and not simulated sample by sample on the network.
- Time sync is modelled at the level of grandmaster states and each merging unit's smpSynch, not PTP message by message.
- Not yet: MMS on the station bus, HSR, SCL configuration files.

## Run

```bash
cd app
npm install
npm run dev     # http://localhost:5174
npm test
```

## Licence

MIT
