# Digital Substation Simulator: Specification

**Status:** design draft (2026-11-11, revised after first review). No code yet.
**Purpose:** A browser-based training simulator for the digital substation. It shows how protection signals travel when trip wires become **GOOSE** messages and CT/VT wiring becomes **Sampled Values (SV)** streams, and what breaks when the network or its configuration is wrong. It runs entirely in the browser.

## Status & backlog (as of 2026-11-11)

**Decided**
- Name and repository: `digital-substation-sim`. MIT licence. Public read-only from the first push (anonymous read on Soft Serve, as with the sibling). Private setup lives in a git-ignored `CLAUDE.local.md`.
- **End goal: one station with three bays** (§ 2.1): two transmission line bays on a bus, plus a load tap off the bus (a transformer behind a single feeder breaker), with many IEDs and differential protection. **Start with one bay** (line A–B) to settle the design; the engine treats the topology as data from day one so bays are added by config, not rewrites.
- First slice: **GOOSE** (§ 3), with the breaker-position GOOSE in the base view. **Then a second bay, still GOOSE only** (slice 2: line A–X, breaker failure between bays), to exercise more messaging before SV adds major complexity. SV, the transformer bay, redundancy and time sync come after (§ 9).
- **Hosting:** localhost dev server and the Soft Serve git remote until feature-complete. Production later via a GitHub Pages workflow; a Docker deploy only at a late stage, if at all.
- Frame depth: **decoded fields** in a protocol-analyzer style view. No raw hex or ASN.1 BER bytes.
- **Test mode deferred to slice 1.1**, with the mode hooks (IED mode/behaviour, the test and simulation flags, the subscriber's test-handling step) in the slice 1 engine (§ 4.7).
- **Time display:** milliseconds everywhere; protection-relevant times (fault to trip, transfer time, breaker opening, clearing) also in cycles, e.g. "17 ms (1.0 cyc)" (§ 4.6).
- One audience, one lesson track; no audience question on the welcome card.
- **Pattern off the Line Protection Simulator** for look, feel and developer experience (§ 10): same stack, repo layout, conventions, panel style and progressive disclosure. No shared code and no data exchange; copy and adapt.
- Typical, published values only, labelled "typical" or "illustrative", and checked against sources before a lesson quotes them (§ 7).

**Built (slice 1, 2026-11-11; first commit and push 2026-11-11)**
- Scaffold: git, `CLAUDE.md`, README, MIT `LICENSE`, `app/` (Vite + React 18 + Tailwind + Vitest, dev port 5174).
- Engine (§ 4): topology as data, discrete-event `simulate(config, scenario)` with warm-up, retransmission (2, 4, 8 … ms to a 1 s heartbeat, TAL = 2 × next gap), store-and-forward network with VLAN checks, subscriber filter / identity / sequence / test hook / TAL supervision, breaker mechanics with Position GOOSE, outcome with transfer-time budget. Mode hooks in place (§ 4.7).
- UI (§ 5): bay view with frames in flight and tap-to-break failure controls (stacked layout on phones), timing chart with two fixed views, outcome card with budget bar, frame list and decoded frame (bottom sheet on phones), sequence of events, lessons, welcome card, ⚙ Network detail.
- Lessons (§ 6): all three; 29 Vitest tests pin the behaviour and every quoted figure.
- Verified by screenshot on desktop, phone (390×844) and ultrawide.

**Built 2026-11-11 (later the same day; not yet committed)**
- **Tour and "?" links** (§ 11.3): *Reading the screen*, seven spotlight steps (bay, timing, frames, decoded frame, outcome, events, header) driving the playback as it goes; started from the welcome pane, the Lessons menu and the end of Foundations. A "?" beside each panel title and each decoded-frame section opens its Foundations chapter.
- **Slice 1.1, test mode** (⚙ Test mode, off by default): each IED's mode (on / test / test/blocked) in the bay's failure panel; test-flagged data treated as invalid by normal-mode subscribers (new frame fate "test: not used"), used by test-mode ones; test/blocked processes but blocks the trip output. Simulation flag rule (only LPHD.Sim IEDs use simulated messages) in the engine; no test-set device yet. Lesson *The relay was left in test*.
- **Slice 2, second bay** (⚙ Second bay and breaker failure, off by default): line A–X (21-AX, SW2, 52-AX) on bus A, trunk L5 between the switches, breaker failure in both line relays (BF trip after 8 cycles, illustrative, if the own breaker is still closed) published as GOOSE to the other bay's breaker IED; new failures: stuck breaker, switch failure; a *Breaker failure* view (−10 to 250 ms). Track *Two bays*: *Breaker failure: the neighbours clear it*, *A lost trip, saved by breaker failure*, *One switch, two bays*, *Right in one bay, missing in the other* (a never-configured subscription: no alarm, because there is nothing to supervise; new failure `subMissing`, new verdict "Fault NOT cleared at bus A").
- Schema v2 (features `testMode`, `secondBay`; relay `line`; `script.faultLine`; `timing.bfCycles`), migration from v1. With both features off the app behaves exactly as slice 1 (tested). 91 tests.

**For the user's review (raised while building, 2026-11-11)**
1. ~~Breaker-failure modelling~~: accepted as built (2026-11-11).
2. Test mode semantics as built: *test* operates physical outputs, *test/blocked* doesn't; a normal-mode subscriber treats test data as invalid and its subscription stays healthy (no alarm). Some IEDs may alarm on test-quality data; confirm against IEC 61850-7-4 Annex A and vendor practice (§ 7).
3. **Test set: built 2026-11-11** (feature Test mode). A test set on the network publishing simulated GOOSE (later SV) that imitates a real IED; IEDs in simulation mode (LPHD.Sim) use it instead of the real one, all others ignore it (the digital equivalent of opening CT test switches and injecting). It sits on PB port 9 and can publish a simulated copy of a trip GOOSE (and inject a simulated trip); IEDs get a Simulation mode (LPHD.Sim) checkbox. As modelled (Edition 2, to confirm, § 7): an IED not in simulation mode ignores simulated frames entirely; one in simulation mode, once it hears a simulated copy, uses it and ignores the real message (new frame fates "simulated: ignored", "real: ignored (sim mode)"). Lesson *Left in simulation mode*: the real trip ignored, no alarm (the test set's heartbeats keep the subscription healthy).
4. ~~Missing-subscription lesson~~: built (2026-11-11).
7. **Topology: decided and built 2026-11-11.** Station bus SB (VLAN 20: relays' station ports, gateway / HMI) and a station-wide process bus PB (VLAN 10: relays' process ports, breaker IEDs, later merging units), drawn as bus bars from control house to yard. Used everywhere, from the first lesson (schema v3; v2 migrates). Relays have two ports and publish GOOSE only on the process port; the gateway's MMS is not simulated yet, so a station-bus failure leaves protection untouched (a lesson try-this). Single networks for now; **redundancy (PRP, A/B networks) is the next slice**. Slice-1 lesson figures are unchanged (relay → breaker is still one switch hop).
5. Phone: SVG text in the denser figures (A1, E3) is small at 390 px.
6. What next: slice 3 (Sampled Values), a review pass of Foundations C–E with fixes, or the GitHub Pages workflow?

**Built 2026-11-11: redundancy (PRP), slice 5 brought forward** (⚙ Redundant process bus (PRP), off by default; schema v4). The process bus becomes LAN A (PBA) and LAN B (PBB); every relay and breaker IED is a doubly attached node sending each frame on both with a 6-byte RCT trailer (sequence number, suffix 0x88FB); the receiver uses the first copy and discards the duplicate (shown per frame as "PRP copies"). PRP supervision: a node alarms when one LAN has been silent for the life-check interval (2000 ms, illustrative), and protection carries on over the other. The test set is single-attached (LAN A). Station view: two thin LAN bars, parallel A/B links, PRP A/B status per device; timing chart: a PRP lane per device; decoded frame: PRP copies and trailer. Lesson *Two networks: nothing lost* (track *Redundancy*). 109 tests.

**For the user's review (redundancy)**
8. PRP on the **process bus only**; station-bus redundancy **waits for MMS** (decided 2026-11-11).
9. PRP supervision is approximated from any traffic on each LAN (real PRP nodes also send their own supervision frames, every 2 s by default); duplicate discard is by the first arrival. Confirm the life-check figure and wording (§ 7).
10. **Next (decided 2026-11-11): an *RSTP vs PRP* lesson, then Sampled Values (slice 3).** HSR stays in the backlog.

**Built 2026-11-11: RSTP vs PRP.** ⚙ Redundant process bus now offers PRP or RSTP (schema v5: `network.redundancy`, `network.rstpRecoveryMs` 50, illustrative). RSTP: the process bus as two ring switches (PB1 for relays and the test set, PB2 for breaker IEDs) joined by R1 (forwarding) and R2 (blocked until R1 fails and the recovery time has passed); frames crossing the ring during recovery are lost. Status line under the bay view. Lesson *RSTP: “the network recovered in 50 ms”*: R1 fails at the fault, the trip gets through on the repeat at 79.7 ms (transfer 64.0 ms), 52-AB opens at 114.0 ms (6.8 cyc), 3.7 cycles slower; with PRP nothing is lost. 114 tests.

**Built 2026-11-11: slice 3, Sampled Values** (⚙ Sampled Values (merging units), off by default; schema v6). A merging unit per line bay (MU-AB, MU-AX) on the process bus (also split by PRP, on PB2 in an RSTP ring) publishing SV (80 samples per cycle, 4800/s, APPID 0x4001…, MAC 01-0C-CD-04-…); the line relay subscribes instead of CT/VT wiring. Engine: no per-sample events; it computes when each relay's stream is good (network path via the same `forward()`, plus merging-unit problems: stop, frozen counter, invalid quality, time sync lost) and the relay (a) declares the stream lost 1 ms after samples stop or freeze (illustrative), invalid at once, and blocks; (b) trips only after a cycle of valid samples after the fault or after samples return. New verdict "Relay did NOT trip". Sampled Values panel: waveforms synthesized from phasors (no DC offset or transients, stated), gaps and frozen samples visible, the sample at the cursor decoded (smpCnt, smpSynch, quality, 8 values) and the SV frame fields. Lessons *The CT wiring is a stream*, *No samples, no protection* (with an RSTP try-this: trip at 66.7 ms, one cycle after samples return). 124 tests.

**For the user's review (SV)**
11. Relay behaviour is a teaching model: 1 ms loss detection, "a cycle of valid samples" before tripping, block on lost / frozen / invalid, carry on when only sync is lost (single merging unit). Confirm or give typical figures.
12. Phone layout with SV: both buses become vertical bars down the sides with the devices stacked between them (long on two bays).
13. ~~Next~~: slice 4 chosen and built (below).

**Built 2026-11-11: slice 4, transformer bay and bus differential** (⚙ Transformer bay and bus differential, off by default; brings the second bay and SV; schema v7). Transformer tap A–T: 87-AT (transformer differential, HV merging unit MU-AT and LV MU-ATL) tripping feeder breaker 52-AT; bus differential 87B-A on bus A from MU-AB, MU-AX, MU-AT, one trip GOOSE subscribed by 52-AB, 52-AX and 52-AT; line breaker failure also trips 52-AT. Fault location (line A–B, bus A, transformer A–T) chosen in the bay view (`script.faultLine`; each relay has a zone, `protects` or `line`). Relays comparing several merging units block when any stream is unusable or the streams are not on a common clock (the Foundations E4 rule, live). Compact three-bay layout with status chips, BLOCKED badge, NO SYNC chip; Sampled Values panel picks one stream at a time. Outcome for a relay tripping several breakers. Lessons (track *Transformer and bus*): *Bus differential: one message, every breaker*, *One clock lost, the whole bus unprotected*, *Transformer differential: both sides or nothing*. 135 tests.

**For the user's review (slice 4)**
14. Zones and behaviour are scripted, not computed: a bus fault is seen only by 87B, a transformer fault only by 87T, a line fault only by the line relay; every bay's waveforms show the same illustrative fault current. Breaker failure on a line trips 52-AT too (bus A cleared). 86 lockouts for 87B / 87T are not modelled (Foundations C4 covers them).
15. Next candidates: the time-sync slice (grandmaster, holdover, sync alarms feeding 87B), MMS on the station bus, or a review / polish pass across lessons.

**Decided 2026-11-12 (user review)**
- **Phone views: viewable, not optimized.** Phones are used for review and debugging; layouts must render readably but needn't be comfortable to use. Desktop is the primary target (relaxes the phone emphasis in § 5 and § 10). Items 5 and 12 above are accepted as is.
- **Breaker IED = PIU, made explicit.** The breaker IED is the bay's process interface unit (binary signals: trip / close out, 52a / 52b position in); the merging unit carries the analogs. The simulator keeps them as two devices so each stream is visible and can fail on its own; Foundations C3, the glossary (PIU) and *The CT wiring is a stream* say that combined MU / PIU devices are common.
- **VT inputs: passing mention.** The bay VTs are wired into the same merging unit (four currents and four voltages per sample, as drawn). VT fuse failure, voltage selection and a shared bus VT with its own merging unit are mentioned (Foundations B1, C3, the SV lesson and panel) but not modelled.

**Backlog:** see § 9.

---

## 1. Audience

Anyone who wants to learn the parts of a digital substation and how they interact. Expect many learners who are not protection engineers: networking, SCADA, commissioning, controls.

- The **protection side** is explained in plain terms: a relay decides to trip, a breaker opens, and a trip that arrives late or not at all has consequences. The app doesn't model why the relay tripped (that is the sibling's job); one sentence per lesson says what the relay decided.
- The **network side** is explained precisely: field names, what each field is for, what the subscriber checks, and the exact rule that marks a message lost.

## 2. The question it answers

The sibling answers "the relay tripped at 17 ms, and here is why." This app answers "and here is how that trip, and the measurements behind it, travelled over the network, and what breaks when the network or its configuration is wrong."

### 2.1 End goal: one station, three bays

```
   to X                                   to B
 ───────── 52-AX ──┬───── bus A ─────┬── 52-AB ─────────
     line A–X      │                 │       line A–B
                           │
                         52-AT   (single feeder breaker)
                           │
                       transformer T
                           │
                         load
```

- **Bays:** line A–X, line A–B, load tap A–T. Each line bay has a merging unit (SV), a protection IED, and a breaker IED (XCBR). The load tap is a transformer behind one feeder breaker, 52-AT: its protection IED has merging units on both sides of the transformer (for 87T) and trips only 52-AT. Ids follow the sibling: `<own bus><far end>`, so relay 21-AB and breaker 52-AB; the load bay is `AT`.
- **Station and process bus** with more than one switch, so the topology view can show which messages share which links.
- **Multi-IED stories this enables** (later slices, not scope now):
  - **Bus differential (87B)** subscribing to SV from all three bays; one stream lost or unsynchronized → the bus zone blocks.
  - **Breaker failure (50BF):** 52-AB doesn't open → its relay publishes a breaker-failure trip that 52-AX and 52-AT must receive.
  - **Transformer differential (87T)** on the load tap, from SV on the HV and LV sides; it trips the single feeder breaker 52-AT.
  - **Interlocking and blocking** between bays (e.g. a reverse-blocking or bus-zone block over GOOSE).
  - **Shared network effects:** one switch failure or one VLAN mistake affecting several bays at once.
- **Line differential (87L)** to the remote ends stays out: the remote substations are not modelled (the sibling covers 87L).

The slice 1 bay is line A–B. Everything in § 4 is written so that adding A–X and A–T means adding IEDs, control blocks, subscriptions and links to the config.

---

## 3. First slice: GOOSE in one bay (A–B)

### 3.1 The bay

> **Topology superseded 2026-11-11:** the bay switch below is replaced by a station bus (SB) and a process bus (PB); see Status item 7. Devices, messages and behaviour are unchanged.

Three devices, one switch:

```
  21-AB  relay IED   ──── port 1 ┐
  (PDIS, PTRC, XCBR sub)         │
                            switch SW1
  52-AB  breaker IED ──── port 2 ┘
  (XCBR, trip coil, PTRC sub)
```

- **Relay IED 21-AB** publishes **GOOSE "Trip"**: dataset with the PTRC trip (`Tr.general`) and its quality. Its decision timing is scripted (§ 3.3).
- **Breaker IED 52-AB** (a switchgear controller with XCBR) subscribes to Trip and energizes the trip coil when it accepts a valid trip. It publishes **GOOSE "Position"**: XCBR `Pos.stVal` as a double point (intermediate / off / on / bad) with quality. The relay subscribes to it. Position is in the base view.
- **Switch SW1:** store-and-forward, with port VLAN membership and priority modelled only as far as the lessons need (§ 4.3).
- **Links:** 21-AB–SW1 and SW1–52-AB, each with a state (§ 3.4).

Two messages in two directions make publish/subscribe concrete: each IED is a publisher for one message and a subscriber for the other.

### 3.2 What happens in a run

A run spans a quiet period before the fault (so heartbeats and supervision are visible), the fault, and a tail after the breaker opens.

1. **Quiet:** both publishers send heartbeats at the slowest interval. Each subscription is healthy.
2. **Fault** at t = 0 (scripted; no fault physics).
3. **Relay trip:** PTRC `Tr.general` goes true. The publisher increments `stNum`, resets `sqNum`, sends at once, then retransmits fast and backs off to the heartbeat (§ 4.2).
4. **Breaker IED** accepts the first valid Trip frame and energizes the trip coil.
5. **Breaker** contacts part. `Pos` goes intermediate, then off (open). Each change is a new state in the Position GOOSE.
6. **Relay** sees Position = off. The run ends with an outcome (§ 4.5).

### 3.3 Scripted timing (illustrative, fixed)

Protection-relevant times are stored in cycles (as in the sibling) and shown in both units; network times are stored and shown in ms / µs.

| Step | Default | Note |
|---|---|---|
| Relay trip after fault | 1 cycle (17 ms at 60 Hz) | Illustrative, as in the sibling; not a setting |
| Relay publish delay (logic → frame on the wire) | to confirm (§ 7) | Part of the transfer time |
| Network: per-hop delay | serialization + switch latency, to confirm | Microseconds at 100 Mbit/s; shown so learners see how small it is |
| Breaker IED: frame accepted → trip coil | to confirm | Part of the transfer time |
| Breaker opening (coil → contacts parted) | 2 cycles, illustrative | Pos intermediate a few ms after the coil, off at contact separation |

The transfer time from relay logic to breaker IED output is shown as a budget bar (publish + network + subscribe) against the IEC 61850-5 class for trip messages (§ 7).

### 3.4 Failures to inject (scenario, not config)

Each is a scenario entry, like the sibling's `relayOos` / `breakerFail`, so it never leaks into settings or lessons that don't set it.

| Failure | Where | Effect |
|---|---|---|
| **Link down** at time t (or for the whole run) | either link | Frames on that link are lost from t |
| **Drop frames** by index (e.g. "the first frame after the trip") | either link | Deterministic loss; no random loss in slice 1 |
| **Subscriber misconfigured**: wrong APPID, wrong `gocbRef`, wrong `datSet`, `confRev` mismatch | a subscription | Frames arrive but are ignored or rejected; the reason is shown on each frame |
| **VLAN mismatch**: publisher tags VLAN x, the egress port is not a member | switch | Frames are dropped at the switch |
| **Publisher in test mode** | an IED | **Slice 1.1.** Hooks exist in slice 1 (§ 4.7) |

### 3.5 Out of the first slice

- Sampled Values, merging units, PTP time sync.
- Bays A–X and A–T, more than one switch, rings, RSTP, PRP/HSR.
- Random loss, jitter, latency distributions, background traffic and queueing contention (the priority tag is shown and explained, not simulated as congestion).
- MMS, reports, the station bus to SCADA.
- Editing SCL files. A read-only excerpt of a subscription's expected values may appear in the frame view to show where they come from.
- Raw hex / ASN.1 BER bytes.
- Routable GOOSE (R-GOOSE) and security (IEC 62351).
- Fault physics and relay decisions (sibling project).

---

## 4. Simulation model (slice 1)

### 4.1 Engine shape

- **Pure ES modules** in `app/src/lib/`, no React, deterministic: the same config and scenario always give the same events.
- **Topology as data:** IEDs, switches, links, control blocks and subscriptions are lists in the config. No code path names 21-AB or 52-AB; slice 1 is simply a config with one bay.
- **Entry point** (working name): `simulate(config, scenario) → { events, frames, outcome }`.
- **Discrete-event timeline:** times in seconds internally (as the sibling), microsecond detail for network hops. Every state change is an event with `kind`, `text`, the device id, and a full state snapshot, so playback, stepping and the timing chart need no recomputation. `events[0]` is the start of the quiet period (t < 0); the fault is at t = 0.
- **Frames are first-class:** every GOOSE frame has an id, publisher, the time it left the publisher, and per hop the time it arrived or the reason it was lost. Each subscription records the frame's fate: accepted, ignored as a retransmission, filtered, rejected (with reason), or never arrived.
- **No randomness.** Loss is specified explicitly (§ 3.4). If random loss ever arrives it uses a seeded generator stored in the scenario.

### 4.2 Publisher

Each GOOSE control block has:
- **Header fields** (decoded, shown in the frame view): destination multicast MAC, VLAN ID and priority (802.1Q), EtherType 0x88B8, APPID.
- **PDU fields:** `gocbRef`, `timeAllowedtoLive`, `datSet`, `goID`, `t` (time of the last state change), `stNum`, `sqNum`, `simulation`, `confRev`, `ndsCom`, `numDatSetEntries`, `allData` (data values with quality).
- **State and sequence numbers:** a data change increments `stNum` and resets `sqNum`; each retransmission of the same state increments `sqNum`. Exact start and rollover values are to be confirmed against IEC 61850-8-1 (§ 7) and pinned by tests.
- **Retransmission profile:** the standard leaves the curve to the implementation. One fixed, illustrative preset: send at once on a change, then repeat at short intervals that double up to a heartbeat interval. Working values: first repeat after 2 ms, doubling, heartbeat 1 s (to confirm as "typical" before a lesson quotes them).
- **timeAllowedtoLive (TAL):** each frame carries the time within which the subscriber should expect the next frame. Working rule: TAL = 2 × the interval to the next scheduled frame (illustrative; to confirm).

### 4.3 Network

- Each link: up / down from time t, plus an optional list of frame indices to drop.
- Each hop adds a fixed delay: serialization (frame length × 8 / link speed, 100 Mbit/s default) plus a fixed switch latency (illustrative). The numbers are shown so learners see that the network is a small part of the budget when it works.
- **Switch:** forwards multicast to the ports that are members of the frame's VLAN (no multicast filtering in slice 1: every member port receives it). A frame tagged with a VLAN the egress port doesn't carry is dropped and logged ("dropped at SW1: port 2 is not in VLAN x").
- **Priority** (802.1Q PCP) is decoded and explained. It has no effect in slice 1 because there is no competing traffic; the lesson text says when it matters (more bays, SV on the same links).
- Path finding over switches is general (a frame follows the switch graph), so a second switch later is config.

### 4.4 Subscriber

For each arriving frame, in order:
1. **Filter:** destination MAC is subscribed, EtherType is GOOSE, APPID matches. A mismatch means the frame is ignored without a reason. The subscription still alarms, but only as "no message": it never receives a valid frame, so nothing tells the learner (or the operator) why.
2. **Identity:** `gocbRef`, `datSet` and `confRev` match the configured subscription. A mismatch means the frame is rejected and the subscription flags a configuration problem.
3. **Sequence:** a new `stNum` is a new state and is processed. The same `stNum` with a higher `sqNum` is a retransmission: it refreshes supervision but changes nothing. Gaps and out-of-order numbers are flagged.
4. **Test / simulation handling:** present in slice 1 as a hook (§ 4.7). With every IED in normal mode and no flags set, it passes everything through.
5. **Supervision:** each accepted frame restarts a timer of length TAL. If it expires the subscription goes **stale**, the subscribed values are treated as invalid, and an alarm is raised. The learner can see the exact frame whose TAL ran out.

Subscription states (a lane on the timing chart): healthy, stale (TAL expired), config mismatch, never received.

### 4.5 Outcome

One line, from data the engine already has:
- **Trip delivered** at T (transfer time X, within / beyond the class) and **breaker open** at T, each in ms and cycles.
- **Trip delivered late** (e.g. by one retransmission interval after a lost first frame).
- **Trip never delivered:** the breaker stayed closed. The text names the cause (link down, ignored for a wrong APPID, dropped at the switch) and adds one sentence on the protection consequence: breaker failure or remote backup has to clear the fault, much later (detail in the Line Protection Simulator; with the second bay in slice 2, 50BF over GOOSE becomes a lesson of its own).
- **Supervision:** whether, and when, an alarm warned of the problem. Key distinction: a misconfigured subscription or VLAN alarms long before any fault (it never sees a valid heartbeat), a link failure only after TAL runs out. A filter or VLAN mismatch alarms only as "no message"; an identity mismatch (gocbRef, datSet, confRev) says what is wrong.

### 4.6 Time and units

- `freqHz` in the config (60 default, 50 selectable later). Protection-relevant times are stored in cycles (`relayTripCycles`, `breakerOpenCycles`), as in the sibling. Network and GOOSE times are stored in ms.
- Display: ms everywhere. Protection-relevant figures (fault → trip, transfer time, trip → breaker open, fault → clear) add cycles: "17 ms (1.0 cyc)". GOOSE intervals, TAL and hop delays stay in ms / µs only.
- One formatting helper (like the sibling's `units.js`, but without the React context) so the rule lives in one place.

### 4.7 Mode hooks (built in slice 1, used in 1.1)

So that test mode lands as a feature, not a rewrite:
- Each IED has a `mode` (Mod/Beh: on, blocked, test, test/blocked, off) and an `lphdSim` flag. Slice 1 configs set `on` / false; there is no UI for them yet.
- Published data carries quality including the `test` bit; frames carry the `simulation` flag. Both are decoded and shown in the frame view from slice 1 (always false), so learners see the fields exist.
- The subscriber's step 4 (§ 4.4) is a real function with tests for the normal-mode pass-through. Slice 1.1 adds the rules (an IED in normal mode doesn't operate on test-flagged data; simulation subscription handling), the ⚙ toggle, and a lesson ("The test set left the relay in test").

### 4.8 Config and scenario

- **Config** (versioned, `version: 1`, `migrateConfig()` from day one, as in the sibling's `schema.js`): `freqHz`, IEDs (with mode), switches and ports (VLAN membership), links, GOOSE control blocks, subscriptions (expected MAC, APPID, `gocbRef`, `datSet`, `confRev`), the retransmission preset, scripted timing, `features.*` toggles.
- **Scenario:** injected failures only (§ 3.4). Lessons set config and scenario together.
- **Feature gate:** one place decides whether an optional feature is active; components never check toggles directly.

---

## 5. Screen layout

Same visual language as the sibling: dark-on-light panels, the same palette approach (`colors.js`, one colour per device), the logic-analyzer timing chart, the sequence-of-events list, the lesson card and the ⚙ Settings drawer. The first screen shows the bay, one timing chart and the outcome. Everything else is one tap away or behind a ⚙ toggle.

**Desktop / ultrawide**
- **Top: station view.** Relay IED, switch, breaker IED and the two links as a small diagram, drawn as one bay of the future three-bay station (the bus and the other bays are not shown in slice 1). A tap on a link, port or IED opens its failure options (the same scenario entries as § 3.4). Frames animate along links during playback (a dot per frame; a cross where one is dropped).
- **Middle: timing chart** (adapted from the sibling's `TimingChart.jsx`):
  - lanes: Fault · PTRC trip (21-AB) · Trip GOOSE on the wire (a tick per frame labelled `st/sq`) · 52-AB: accepted / ignored / rejected · Trip coil · Breaker position · Position GOOSE on the wire · Subscription state (each subscriber).
  - Two fixed zoom presets instead of free zoom: **"around the trip"** (about −5 to +100 ms) and **"heartbeats"** (several seconds), because the burst after a change is milliseconds and the heartbeat is seconds. A gap marker shows skipped quiet time.
  - Play / step / step to next frame (as the sibling's `SimControls`); one cursor shared with the other panels.
- **Right: outcome**, transfer-time budget bar, and the lesson card when a lesson is running.
- **Bottom: frame list** like a protocol analyzer: time, source, destination, APPID, `stNum`, `sqNum`, TAL, and the fate at each subscriber. Selecting a frame (here or on the chart) opens the **decoded frame**: a tree of Ethernet / 802.1Q / GOOSE header / PDU / dataset values, each field with a one-line plain explanation, and for a rejected frame the expected vs received value side by side.
- **Sequence of events** (as the sibling's `EventLog`): the device-level story (trip, coil, breaker open, subscription stale) beside the frame list, collapsible.

**Phone (390×844)**
- Stacked: lesson card, station view, timing chart (horizontal scroll inside the chart only, no page scroll), outcome, frame list. The decoded frame opens as a bottom sheet.

**⚙ toggles (all off by default; with one off the app behaves exactly as before it existed)**
- Network detail: per-hop timing and the VLAN/priority fields expanded in the frame view.
- Test mode (slice 1.1).

---

## 6. Lessons (slice 1)

Each lesson: a one-sentence setup, "watch for", "try this", and a key point, in the sibling's lesson format (data in `lessons.js`, run by the test suite). Every number a lesson quotes is checked by a test; when the test disagrees with the text, the text is fixed.

**1. A trip is a message** (normal operation)
- Setup: 21-AB trips 1 cycle (17 ms) after the fault and publishes it as GOOSE.
- Watch for: quiet heartbeats, then `stNum` steps up and a burst of frames with rising `sqNum` and short TAL, backing off to the heartbeat. 52-AB acts on the first frame; the rest change nothing. Then the Position GOOSE goes intermediate, then off.
- Try this: step frame by frame and open each frame's decoded view.
- Key point: GOOSE has no acknowledgement. Reliability comes from repetition, and the subscriber knows the publisher is alive only because heartbeats keep arriving within TAL. The relay learns the breaker opened from a second GOOSE going the other way.

**2. The relay tripped, but the breaker never heard it** (commissioning miss)
- Setup: 52-AB's subscription expects a different APPID (or `gocbRef`).
- Watch for: every Trip frame reaches 52-AB and is ignored or rejected. The trip coil never energizes; the outcome says the breaker stayed closed.
- Try this: switch between wrong APPID (ignored; the alarm only says "no message"), wrong `gocbRef` / `confRev` (rejected; the configuration alarm says why), and VLAN mismatch (dropped at the switch; the subscriber never sees a frame, and the Position GOOSE is lost too). Every case alarms from before the run.
- Key point: the frames were on the wire the whole time. A misconfigured subscription alarms from the day it is loaded, long before any fault; how much the alarm explains depends on what is wrong. Commissioning tests and following up alarms catch it, the fault doesn't.

**3. One lost frame, and a dead link** (network loss)
- Setup: normal operation, with failures on the 21-AB–SW1 link.
- Watch for: with the first frame after the trip dropped, the first retransmission delivers the trip one retransmission interval later.
- Try this: take the link down during the quiet period instead: 52-AB marks the Trip subscription stale when TAL runs out, and the later trip is lost. Compare the time from link down to alarm with the heartbeat.
- Key point: fast repeats after a change make one lost frame cheap. Supervision tells you a link is gone within about a heartbeat or two, but it is an alarm, not a fix; redundancy (PRP/HSR, a later slice) is the fix.

---

## 7. Figures to confirm before lessons quote them

Each entry gets a source and a test. Until confirmed, the UI labels it "illustrative".

| Figure | Working value | Source to check |
|---|---|---|
| GOOSE EtherType | 0x88B8 | IEC 61850-8-1 |
| Recommended multicast MAC and APPID ranges for GOOSE | 01-0C-CD-01-xx-xx; APPID 0x0000–0x3FFF | IEC 61850-8-1 |
| Default VLAN priority for GOOSE | 4 | IEC 61850-8-1 |
| `stNum` / `sqNum` behaviour | stNum +1 per change, sqNum reset to 0 and +1 per repeat (confirmed in vendor documentation, 2026-11-11). Start value (stNum 1) and rollover: still to confirm | IEC 61850-8-1 (Ed. 2) |
| Retransmission profile (first repeat, doubling, heartbeat) | 2 ms, doubling, 1 s | Not fixed by the standard (doubling up to a cap is the common description); labelled illustrative |
| TAL relative to the retransmission interval | 2 × next interval | Vendor documentation describes TAL as double the next resend time, citing IEC 61850-8-1; implementations differ, labelled illustrative |
| Transfer-time class for trip messages | 3 ms (class TT6, type 1A, performance class P2/P3; P1 is 10 ms) | IEC 61850-5. Consistent across vendor-neutral and vendor papers checked 2026-11-11; quoted in lessons |
| What the transfer time includes (publisher stack + network + subscriber stack) | logic in one IED to logic in the other (t = ta + tb + tc) | IEC 61850-5. Consistent across sources checked 2026-11-11 |
| Budget split of the transfer time | 40 % publisher, 20 % network, 40 % subscriber (→ 0.6 ms network for a 3 ms trip) | Cited from IEC 61850-10 in one paper only; not yet confirmed. Used only to pick the illustrative 1 ms stack times, not quoted |
| Switch latency and serialization at 100 Mbit/s | microseconds | IEC 61850-90-4, arithmetic |
| Mod/Beh values and test-flag handling (Foundations B6, slice 1.1) | on-mode subscriber treats test data as invalid; test-mode subscriber uses it; test/blocked blocks physical outputs; simulated messages accepted only with LPHD.Sim | IEC 61850-7-4 Annex A, IEC 61850-8-1 Ed. 2 |
| SCL formats (Foundations D1): APPID as 4 hex digits, VLAN-ID as 3, MinTime / MaxTime in ms, GSEControl `appID` = goID, ExtRef `srcCBName` / `intAddr` (Ed. 2) | as generated by `sclExcerpt` | IEC 61850-6 Ed. 2 |
| PTP (Foundations E3–E5): power utility profile target ±1 µs; clock class 6 / 7 / 248; BMCA order priority1 → clock class → … → priority2; Layer 2 multicast transport | as stated | IEC 61850-9-3, IEEE C37.238, IEEE 1588-2019 |
| `smpSynch` values 0 / 1 / 2 (Foundations E4) and how protection reacts (typical; vendors differ) | as stated | IEC 61850-9-2 Ed. 2.1 / IEC 61869-9; vendor manuals |
| Oscillator stabilities for holdover (Foundations E5) | 1 ppm, 0.01 ppm, 0.0001 ppm (illustrative, constant-error model) | Vendor-neutral references |
| SV details as modelled (slice 3): smpCnt restarting each second on synchronized merging units, MAC 01-0C-CD-04-xx-xx, APPID 0x4000–0x7FFF, 8-value dataset; relay loss detection 1 ms and one cycle of valid samples before tripping (illustrative) | as stated | IEC 61850-9-2 / 9-2LE, IEC 61869-9; vendor manuals |
| Sampled Values rate (Foundations B1) | 80 samples per cycle, 4800/s at 60 Hz | IEC 61869-9 / UCA 9-2LE |
| Logical-node classes and the device-number mapping (Foundations B2) | as `LN_TABLE` in `figures.js` | IEC 61850-7-4; IEEE C37.2 for device numbers |
| Breaker opening time | 2 cycles, illustrative | Typical published breaker ratings |

---

## 8. Open questions

None open for slice 1. Settled in review (2026-11-11): load tap = transformer behind a single feeder breaker; second bay (GOOSE) before SV; hosting = localhost + Soft Serve until feature-complete, then Pages.

---

## 9. Later slices (outline, not scope)

- **1.1 Test mode** (built 2026-11-11): Mod/Beh, test flags, lesson *The relay was left in test*. Simulation flag: engine rule only (no test-set device yet).
- **2 Second bay, GOOSE only** (built 2026-11-11, behind ⚙): line A–X on bus A (21-AX, 52-AX), a second switch so messages share some links and not others. New messaging: **breaker failure (50BF)** (52-AB stays closed → 21-AB publishes a BF trip that 52-AX must subscribe to), one publisher with several subscribers, a subscription that is right in one bay and missing in the other, and one switch or VLAN mistake affecting both bays. Still no SV.
- **3 Sampled Values:** merging unit streams in the line bays: sample counter, quality, `smpSynch`; what the relay blocks when samples stop, freeze or lose time sync. Waveforms synthesized from hand-written phasors (no DC offset, no transients; said so in the UI). Static fixtures from the sibling engine only if more realism is ever wanted.
- **4 Transformer bay and differentials (built 2026-11-11, behind ⚙):** load tap A–T (transformer, single feeder breaker 52-AT, HV and LV merging units); 87T tripping 52-AT; 87B on bus A from all three bays' SV, with 50BF from slice 2 feeding it.
- **5 Redundancy (PRP built 2026-11-11):** PRP A/B process bus; RSTP vs PRP/HSR, "the network recovered in 50 ms" vs a trip budget; priority under load with SV on the same links.
- **6 Time sync:** PTP grandmaster loss, holdover, what SV subscribers (especially 87B) do with unsynchronized samples.
- **Configuration files:** a read-only walk through the SCL chain (specification, ICD/CID, SCD) showing where each subscription value comes from.
- Raw hex / BER view, if the network audience asks for it.

---

## 10. Developer experience (pattern: Line Protection Simulator)

Copy the sibling's structure and habits; adapt the code, don't share it.

- **Repo layout:** `SPEC.md`, `CLAUDE.md`, `README.md`, `LICENSE` (MIT), `docs/`, `app/` (Vite project: `src/lib/` engine, `src/components/`, `src/hooks/`). Git-ignored `CLAUDE.local.md` for machine setup. Pages workflow and Docker files are added when those stages arrive, not in the scaffold.
- **Stack:** React 18 + Vite + Tailwind, Vitest; same versions as the sibling where they still fit.
- **Engine:** `lib/schema.js` (config, defaults, `migrateConfig()`), a timeline module (`simulate`), `lessons.js` (data), `colors.js`, a units helper, one test file pinning behaviour and every lesson's figures.
- **UI pieces to adapt:** `TimingChart`, `SimControls`, `EventLog`, `Lessons`, `SettingsPanel`, `Welcome` (welcome card without the audience question).
- **Conventions carried over:** ids `<own bus><far end>`; protection times stored in cycles; schema change = version bump + migration + migration test; new features behind `config.features.*`, gated centrally; every state change an event with a snapshot.
- **Verifying changes:** `npm test`, `npm run build`, screenshots on desktop and ultrawide (3440×1440) when layout changes, and a check that phone (390×844) still renders readably (review and debugging only, decided 2026-11-12), then update SPEC § Status & backlog and README.
- **Hosting by stage:**
  - **Development (until feature-complete):** Vite dev server on localhost, previewed from the phone over the private tailnet only (details in `CLAUDE.local.md`); git on Soft Serve. The dev server is never exposed publicly.
  - **Production:** a GitHub Pages workflow (tests, build with a `VITE_BASE`, deploy), as in the sibling; asset paths stay relative to Vite's `base` from the start so this needs no rework.
  - **Docker** (unprivileged nginx behind a host reverse proxy, as in the sibling): late stage, only if self-hosting is wanted.

---

## 11. Foundations module (design 2026-11-11, decisions in § 11.7)

**Why.** First review of slice 1: a substation-savvy learner (knows CTs, relays, trip circuits, breakers, schematics) can't yet read the simulator screen. APPID, gocbRef, VLAN, stNum and TAL are each a concept from a field they haven't studied: Ethernet networking, the IEC 61850 data model and messaging, and SCL engineering. The simulator makes sense only after a guided overview of the network components, the messaging components and the configuration items.

**What.** A second top-level view beside the simulator, in the sibling's tab style: **Foundations | Bay simulator**. Short chapters, each one concept, one small interactive figure, plain text, and a link into the simulator that shows the same thing in place ("on the simulator screen, this is the APPID column").

**Principles**
- **Start from copper.** Every chapter anchors on something the learner already knows (contact, wire, terminal block, trip-circuit supervision, wiring diagram) and says what replaces it. The copper ↔ digital table below is the spine.
- **Assume no networking knowledge.** Start from "what is a frame"; no acronym before it is explained.
- **One concept per chapter, one figure per chapter.** Readable on a phone in a few minutes. No figure needs more than two or three controls.
- **Reuse the engine.** Figures that move frames (switch forwarding, VLANs, GOOSE repeats) run the real `network.js` / `timeline.js` on tiny topologies, so Foundations and the simulator never disagree.
- **Every number tested**, as for lessons.
- **Not a textbook.** Each chapter stops where the simulator can take over; deeper detail stays in the standards.

### 11.1 Copper ↔ digital (the spine)

| In a hard-wired substation | In a digital substation | Chapter |
|---|---|---|
| Relay output contact closes | A data value changes (`PTRC1.Tr.general` = true) | B2, C1 |
| Wire, cable, panel wiring | Ethernet link (usually fibre) through switches | A1–A3 |
| Terminal block and wire number: where the signal is | The message's identity: control block (`gocbRef`), dataset, APPID, multicast address | B3, D2 |
| Breaker trip-coil input | Breaker IED (XCBR) subscribed to the trip message, driving its output | B5, C3 |
| 52a/52b auxiliary contacts back to the relay | Position GOOSE (`XCBR1.Pos`) | B4 |
| Auxiliary / repeat relay fanning one trip out | Several subscriptions to one message | C2 |
| Trip-circuit supervision | Subscription supervision (TAL) and its alarm | B5 |
| Schematics and wiring diagrams | The SCD file, the signal matrix | C5, D1 |
| Test switches, isolating links | IED mode / behaviour, test and simulation flags (slice 1.1) | B6 |
| CT/VT secondary wiring | Sampled Values from a merging unit (slice 3) | B1 |
| Point-to-point and continuity checks | Checking frames with a network analyzer, subscription status, end-to-end trip test | D3 |

### 11.2 Chapters (draft)

**Part A: The network** (Ethernet for substation people)
- **A1. From wires to messages.** A hard-wired trip and a GOOSE trip side by side: contact → wire → coil vs data change → message → switch → breaker IED → coil. What each new box is (relay IED, switch, breaker IED / merging unit in the yard). *Figure:* the two paths animated together.
- **A2. Frames and MAC addresses.** A frame is an envelope: destination, source, type, payload, check. A MAC address is a device's hardware address; links are point to point and full duplex (no collisions). *Figure:* one frame, parts highlighted on tap.
- **A3. Switches; unicast, broadcast and multicast.** A switch forwards frames between ports. Unicast goes to one device, broadcast to all, multicast to a group; GOOSE is multicast because one publisher has many subscribers, and a switch floods multicast unless told otherwise. *Figure:* a 4-port switch; send each kind and watch which ports get it.
- **A4. VLANs and priority.** The 802.1Q tag adds a VLAN ID and a priority. A switch port only carries the VLANs configured on it; priority decides which frame leaves first when frames queue. *Figure:* the same switch, toggle a port's VLAN; a busy port with and without priority.
- **A5. Layers, and why GOOSE has no IP address.** A light OSI model: Layer 1 (physical), Layer 2 (Ethernet: frames, MAC, VLAN, switches), Layer 3 (IP, routers), Layer 4 (TCP/UDP), application. The working vocabulary ("a Layer 2 network", "a Layer 3 switch", "a Layer 1 problem"). MMS uses the whole stack and can be routed; GOOSE and SV go straight from the application to Layer 2, so they are fast and stay inside their network. Station bus and process bus. *Figures:* the three stacks side by side; a station sketch of what crosses a router. Earlier chapters name their layer in passing ("a Layer 2 device, see A5") instead of a separate layers chapter (decided 2026-11-11).
- **A6. Preview: when the network fails.** Redundancy (RSTP vs PRP/HSR) and time sync (PTP) in one paragraph each, pointing to later slices. No figure.

**Part B: IEC 61850 messaging**
- **B1. Three kinds of message.** MMS (client/server: SCADA reads, reports and controls), GOOSE (publish/subscribe events between IEDs), Sampled Values (publish/subscribe measurements). A table: who talks to whom, how fast, which network. *Figure:* the station sketch with the three flows.
- **B2. Names for everything: the data model.** `LineProtABPROT/PTRC1.Tr.general` taken apart: IED, logical device, logical node, data object, attribute. Logical nodes as function blocks the learner knows by device number: PDIS (21), PTOC (51), PDIF (87), RBRF (50BF), PTRC (trip conditioning, the output that trips), XCBR (the breaker), CSWI (control), TCTR / TVTR (CT / VT). Quality and timestamp travel with values. *Figure:* a name with tappable parts.
- **B3. Datasets and control blocks.** The dataset says *what* is sent; the GOOSE control block says *how*: gocbRef, APPID, multicast MAC, VLAN, confRev. One publisher, any number of subscribers. *Figure:* a control block card wired to the frame fields it fills.
- **B4. Publishing: state, sequence, heartbeat.** A change sends at once and repeats fast, then backs off to a heartbeat; stNum counts changes, sqNum counts repeats. No acknowledgement. *Figure:* the mini timeline from the engine, one button: "change the value".
- **B5. Subscribing and supervision.** What a subscriber checks in order (address/APPID, identity, sequence) and what it does when nothing arrives within TAL. The alarm is the digital trip-circuit supervision. *Figure:* one frame through the checks, with a "break it" picker.
- **B6. Quality, test and simulation.** Preview for slice 1.1; how the digital equivalent of a test switch works.

**Part C: Virtual wiring: schematics in a digital substation** (added 2026-11-11; after messaging, because it needs subscriptions)
- **C1. Where did my contact go?** A relay output contact on the schematic becomes a value in a dataset; its contact symbol becomes a row in a signal list. *Figure:* the same trip path as a copper schematic and as its digital equivalent.
- **C2. Where did my aux relay go?** A repeat / auxiliary relay that fans one trip out to several places becomes several subscriptions to one message. *Figure:* aux relay with five contacts vs one publisher and five subscribers.
- **C3. Dry contacts at the edges.** Copper stays in the yard: the breaker IED reads 52a / 52b as binary inputs (wetted by the IED) and drives the trip coil from a real output contact, through 52a. *Figure:* breaker IED I/O drawn as a schematic.
- **C4. Lockouts and seal-ins in logic.** 86 lockout, seal-in and latching move into IED logic and published states; what that means for drawings, testing and resetting.
- **C5. The new wiring diagram.** The publisher / subscriber signal matrix and each IED's mapping from network inputs to logic ("virtual inputs"), as the documents a technician works from.
- Drawing convention: **ANSI / IEEE** device numbers and contact symbols (52a / 52b, 86, 94, NO / NC contacts), consistent with the 60 Hz context.

**Part D: Configuration and engineering** (was Part C)
- **D1. The SCL files.** SSD (system specification), ICD (what an IED type can do), SCD (the whole substation: IEDs, communication, datasets, control blocks, subscriptions), CID / IID (what is loaded into one IED). Who makes which (system configurator, IED configurator) and the analogy to one-line → schematics → wiring diagrams. *Figure:* the workflow, tap a file to see a short excerpt.
- **D2. Where each value lives.** Every configuration item on the simulator screen, where it is set, and what breaks if two places disagree: MAC, APPID, VLAN ID and priority (control block, in the SCD), gocbRef / datSet / confRev (publisher, in the SCD), the subscriber's expected values (its inputs, from the SCD), switch port VLANs (switch configuration, usually managed outside SCL). *Figure:* a table linked to the simulator's failure controls.
- **D3. Commissioning: proving the digital wiring.** What replaces point-to-point checks: frames seen on the network, subscription status in each IED, end-to-end trip tests, and the classic misses (the simulator's failure list). *Figure:* none; links to lessons.

**Part E: Time** (added 2026-11-11; after Part D, but readable any time after Part B. Feeds simulator slice 6, § 9)
- **E1. Two kinds of time: latency and timestamps.** Latency is how long a message takes (the 3 ms trip class); a timestamp says when something happened (GOOSE `t`, an SV sample's count). A sequence of events from several IEDs is only as good as their clocks agree.
- **E2. Time is phase angle.** At 60 Hz, 1 ms of time error is 21.6° and 1 µs is 0.0216°. Two merging units a time Δt apart make a through current look like a differential current of 2·sin(θ/2)·I (the same arithmetic as the sibling's 87L channel-asymmetry lesson). Why Sampled Values need about a microsecond. *Figure:* two current waves with a time-offset slider and the resulting false differential.
- **E3. Where time comes from.** GPS / GNSS receiver → grandmaster clock → PTP over the same Ethernet (IEEE 1588; power utility profile IEC 61850-9-3 / IEEE C37.238) → boundary and transparent clocks in the switches → each IED's clock. Best master clock selection; master / grandmaster vs the newer "time transmitter / time receiver" wording. The copper predecessor: IRIG-B and 1PPS on coax. *Figure:* the clock tree; fail the grandmaster and watch another take over.
- **E4. Is my time good?** Sync status everywhere: PTP clock class and accuracy, SV `smpSynch` (none / local / global), time quality in timestamps, IED "time OK" / "sync lost" outputs and alarms. What protection does with them: a function comparing several merging units (87B, 87T) blocks or falls back; a function using one merging unit can carry on.
- **E5. Holdover and failure.** Losing GPS or the grandmaster: clocks drift at their oscillator's rate; how long until the error passes a microsecond; redundant grandmasters.
- Figures to confirm (adds to § 7): IEC 61850-9-3 accuracy target (±1 µs at the end device), `smpSynch` values, typical holdover figures, IEEE 1588 terminology.

**Then:** *Reading the simulator screen*, a tour that points at each panel (bay view, timing chart lanes, frame list columns, decoded frame, outcome) and links each to its chapter. The existing *GOOSE basics* lessons follow.

### 11.3 Changes to the simulator screen

- Labels and column headers on the simulator screen link to their Foundations chapter (a small "?"), and the decoded-frame field help links to B2–B5.
- A **glossary** (one line per term, shared by Foundations and the simulator) so every term on the screen has a definition one tap away.
- The welcome card offers two starts: *Start with the foundations* or *Go to the simulator*. No audience question.

### 11.4 Tracks

1. **Foundations** (Parts A–C, this section).
2. **GOOSE basics** (§ 6, the existing lessons).
3. Later tracks follow the slices (second bay, SV, redundancy, time sync).
4. Possible later: **Protection for network people**, the same spine read the other way for networking / SCADA learners (what a trip, a breaker and clearing time are). Not planned until asked; the Line Protection Simulator covers much of it.

### 11.5 Build order

1. Foundations view shell (tab, chapter list, chapter page, progress per browser, phone layout) and the glossary.
2. Part A with its figures (reusing `network.js` on tiny topologies).
3. Part B, then Part C (virtual wiring), Part D (configuration), Part E (time).
4. "?" links from the simulator screen and the screen tour.

### 11.6 Figures to confirm (adds to § 7)

Logical-node names and meanings (IEC 61850-7-4), SCL file types and their roles (IEC 61850-6 Ed. 2), Ethernet frame field sizes, 802.1Q tag layout.

### 11.7 Decisions (2026-11-11)

1. **Form:** a separate Foundations view (tab), not lessons on the simulator screen.
2. **First view:** the app still opens on the simulator, full screen as built. Its welcome pane points to Foundations ("new to digital substations? start here"). Revisit a reduced first view after the user has been through Foundations.
3. **Part A starts at "what a frame is"**, with a skip-ahead for learners comfortable with basic networking: a short self-check (three questions with answers) and a button to skip to A5.
4. **Protection for network people:** kept in the plan (§ 11.4), not started. One track at a time.
