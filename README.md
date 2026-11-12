# Digital Substation Simulator

An interactive, browser-based training simulator for the digital substation: how a protection trip travels as an IEC 61850 **GOOSE** message instead of over a wire, and what breaks when the network or its configuration is wrong.

Companion to the Line Protection Simulator, which answers "the relay tripped at 17 ms, and here is why". This one answers "and here is how that trip travelled over the network".

**Status:** slice 1 (GOOSE in one bay) in development. See `SPEC.md`.

## What it shows

- **One bay** (line A–B): line relay 21-AB, a bay switch, breaker IED 52-AB. The relay publishes a Trip GOOSE; the breaker IED publishes its position back.
- **Timing chart** in the style of a logic analyzer: device signals, every frame on the wire (labelled stNum/sqNum and colored by what the subscriber did with it), and each subscription's supervision state. Two views: around the trip (ms) and heartbeats (s).
- **Decoded frames** in the style of a protocol analyzer, every field with a one-line explanation, and expected vs received values for a frame the subscriber ignored or rejected.
- **Failures to inject:** link down (fixed presets), one lost frame, a subscription engineered with the wrong APPID, gocbRef, dataset or confRev, a switch port missing the VLAN.
- **Outcome:** transfer time against the 3 ms class for trip messages (IEC 61850-5, TT6), breaker open time, and which alarms warned, and when.
- **Lessons:** *A trip is a message*, *The relay tripped, but the breaker never heard it*, *One lost frame, and a dead link*.

## Model notes and limits

- The fault and the relay's decision are **scripted** (trip 1 cycle after the fault); this simulator is about how signals travel, not why the relay tripped.
- Retransmission profile, IED stack times, switch latency and breaker timing are **illustrative**; IEC 61850-8-1 leaves the retransmission curve to the implementation.
- Deterministic: no random loss, jitter or background traffic. VLAN priority is shown and explained but has no effect without competing traffic.
- Not yet: Sampled Values, more bays, PRP/HSR, time sync, test mode (next).

## Run

```bash
cd app
npm install
npm run dev     # http://localhost:5174
npm test
```

## Licence

MIT
