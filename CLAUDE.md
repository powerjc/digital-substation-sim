# Digital Substation Simulator

IEC 61850 training simulator (GOOSE now; Sampled Values, more bays and redundancy later). React + Vite + Tailwind, pure client-side. Spec: `SPEC.md` (start with § Status & backlog). App code: `app/`. Sibling project: Line Protection Simulator (separate repo, no shared code, no data exchange; its `docs/iec61850-interface.md` holds the dividing line).

## Architecture

Pure simulation logic lives in `app/src/lib/` (no React — keep it that way so it stays testable):

| File | Role |
|------|------|
| `schema.js` | Config schema (v2; v1 migrates): the station as data (IEDs, switches, links, GOOSE control blocks, subscriptions), scripted timing, stack and network figures, `features`. `migrateConfig()`, `PROFILES` (retransmission), `TRIP_CLASS` |
| `station.js` | `stationConfig(config)`: the station the engine runs. Station bus SB + process bus PB in the base config; feature `secondBay` adds bay A–X and breaker-failure GOOSE; feature `testMode` adds the test set TS on PB port 9; feature `timeSync` (implies `sampledValues`) adds grandmasters GM1 / GM2 on PB (`lib/ptp.js` drives each merging unit's smpSynch); feature `transformerBay` (implies `secondBay` + `sampledValues`) adds 87-AT, 52-AT, 87B-A (relays have a zone: `protects` 'XFMRAT' / 'BUSA', else `line`); feature `mms` adds a report control block per relay (`rcbs`: client GW, `buffered`, items trip / bf / pos) and, with PRP, splits SB into SBA / SBB (`prpSupervision: 'frames'`); feature `sampledValues` adds merging units MU-<bay> (+ MU-ATL) with `svcbs` / `svSubs`; feature `redundancy` splits PB into PRP LANs PBA / PBB (switch `lan: 'A' | 'B'`, IED ports `P.A` / `P.B`, breaker `A` / `B`), or with `network.redundancy: 'rstp'` into ring switches PB1 / PB2 with links R1 (`rstp: 'active'`) and R2 (`rstp: 'standby'`, `backs: 'R1'`) |
| `scenario.js` | Injected failures (`linkDown` / `linkUp`, `switchDown` / `switchUp`, `rcbUnbuffered`, `drops`, `subWrong`, `vlanMissing`, `iedMode`, `breakerStuck`, `switchDown`), `applyScenario()` (engineering errors applied to a config copy), fixed `LINK_PRESETS` |
| `network.js` | Topology from links, `forward()`: carries a frame through store-and-forward switches (VLAN membership on ingress and egress, link down, explicit drops), hop timing |
| `goose.js` | Frame building and length estimate, the subscriber's checks in order: `matchFrame` (filter: MAC/APPID → ignored; identity: gocbRef/datSet/confRev → rejected), `sequenceCheck`, `testHandling` (slice 1.1 hook, pass-through now) |
| `timeline.js` | Discrete-event engine `simulate(config, scenario)`: warm-up (not shown), quiet period, scripted fault and trip, publishing with retransmission and TAL, subscriber supervision, breaker mechanics, outcome. Emits events (each with a full state snapshot) and frames (each with hops and its fate per subscription) |
| `lessons.js`, `tour.js` | Lesson content and the screen tour (data) |
| `foundations.js`, `glossary.js`, `figures.js` | Foundations module: chapter content (data, `{{term}}` / `**bold**` markup), shared glossary, pure helpers behind the figures (the switch figures run `network.js` on a four-device demo topology) |
| `units.js`, `colors.js`, `features.js` | Time formatting (ms, plus cycles for protection-relevant times); colors; feature gate (`isActive`) |

Two views (tabs): **Bay simulator** (default) and **Foundations** (`components/foundations/`: chapter list, chapter page with copper anchor, figure, key point, link into the simulator; glossary term bar).

Data flow: `App` (config) → `stationConfig` → `useRun` (scenario, zoom, playback) → `simulate` → `StationView` (bay diagram, frames in flight, failure controls), `TimingChart` (logic analyzer with frame lanes and subscription status), `OutcomeCard` (verdict, transfer-time budget), `FrameList` / `FrameDetail` (protocol-analyzer view; bottom sheet on phones), `EventLog`.

## Conventions

- **Topology is data.** No engine code names a device; slice 1 is a config with one bay (A–B). The end goal (SPEC § 2.1) is bus A with lines A–X, A–B and a transformer tap A–T; new bays are config entries plus a `LAYOUT` entry in `StationView`
- **Ids** `<function>-<own bus><far end>` as in the sibling: relay `21-AB`, breaker IED `52-AB`; links `L1…`; switches `PB` (process bus) and `SB` (station bus); gateway `GW`, test set `TS`
- **Topology:** link ends are `ied`, `ied:port` (relays: `P` process, `S` station) or `switch:n`. A control block with `port` is published only on that port (relays publish on `P`). Bus bars in `StationView` layouts carry `bar: true`
- **Units:** protection-relevant times stored in cycles (`relayTripCycles`, `breakerOpenCycles`, …); communication times in ms; network in Mbit/s and µs. Engine time in seconds; the fault is at t = 0; the run starts at `START_T` (−3 s). Display: ms everywhere, plus cycles for fault → trip, transfer, breaker open, clearing
- **Determinism:** no randomness. Loss is explicit (`drops` by link, control block, stNum, sqNum)
- **Schema changes:** bump `version`, add a migration step, add a migration test
- **Progressive disclosure:** optional features behind `config.features.*`, gated only through `isActive()`; with a feature off the app behaves exactly as before
- **Failures are scenario, not config**, so they never leak into settings or lessons that don't set them
- **Test mode** (feature `testMode`): IED `mode` via `scenario.iedMode`; `testHandling` = simulation rule (LPHD.Sim) then test rule (IEC 61850-7-4 Annex A as taught); frame fate `testIgnored`; breaker IED in test/blocked never energizes its coil
- **Engine relies on bays:** a relay trips if its `line` is `script.faultLine`; a breaker is the relay's by `bay`; breaker failure checks the own-bay breaker. Keep those fields on new IEDs
- **PRP:** the engine finds doubly attached nodes from links to switches with `lan`; it adds the RCT (frame `rct`, +6 bytes), keeps both copies per subscription in `frame.copies`, uses the first, and raises `prpLan` events after `network.prpLifeCheckMs` of silence on a LAN (state `prp[ied]`)
- **MMS:** reports only (no controls). `simulate` probes the relay → gateway path with `forward()` at network cut times; the gateway declares an association lost after `mms.assocTimeoutS`, reconnects `mms.reconnectS` after the path returns, then replays a buffered report and does a general interrogation. State `mms[relay]`, `scada[relay]`; result `reports`. Station-bus PRP nodes are keyed `<ied>@S` and supervised from PRP supervision frames (no GOOSE there)
- **Sampled Values:** never simulated per sample. `simulate` builds `svHealth[subId]` segments (network probe with `forward()` at each failure time, plus `scenario.svFault`); relay trips and `svLost` / `svOk` / `svSync` events derive from them; `lib/sv.js` synthesizes any sample for display
- **Help links:** `<HelpLink chapter="B4" />` (via `HelpContext`) beside panel titles; only built chapters render
- **Figures:** typical, published values only, labelled "illustrative" until confirmed (SPEC § 7). No organization-specific settings or practices in anything tracked
- **Foundations:** one concept, one figure per chapter; every `{{term}}` must exist in `glossary.js`; numbers quoted in chapters are tested like lesson figures
- **Lessons:** every number a lesson quotes is checked in `sim.test.js`; each lesson declares `expect.verdict`. When a test disagrees with the text, fix the text

## Verifying changes

1. `npm test` in `app/` (Vitest: `sim.test.js` with every lesson, `foundations.test.js` with every chapter figure and glossary link)
2. `npm run build`
3. UI changes: screenshot with headless Chromium (Playwright, outside the project); check desktop and ultrawide (3440×1440) when layout changes, and that phone (390×844) still renders readably (phone is for review and debugging, not optimized)
4. Docs: SPEC § Status & backlog, README

## Run

```bash
cd app
npm install
npm run dev        # http://localhost:5174
npm test
npm run build      # → app/dist (static)
```

Machine-specific setup (source/test copies, remote access, git remote) lives in `CLAUDE.local.md` (git-ignored) when present. Keep organization specifics out of tracked files: the repo is publicly readable.
