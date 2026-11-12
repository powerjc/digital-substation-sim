# Digital Substation Simulator

IEC 61850 training simulator (GOOSE now; Sampled Values, more bays and redundancy later). React + Vite + Tailwind, pure client-side. Spec: `SPEC.md` (start with § Status & backlog). App code: `app/`. Sibling project: Line Protection Simulator (separate repo, no shared code, no data exchange; its `docs/iec61850-interface.md` holds the dividing line).

## Architecture

Pure simulation logic lives in `app/src/lib/` (no React — keep it that way so it stays testable):

| File | Role |
|------|------|
| `schema.js` | Config schema (v1): the station as data (IEDs, switches, links, GOOSE control blocks, subscriptions), scripted timing, stack and network figures, `features`. `migrateConfig()`, `PROFILES` (retransmission), `TRIP_CLASS` |
| `scenario.js` | Injected failures (`linkDown`, `drops`, `subWrong`, `vlanMissing`), `applyScenario()` (engineering errors applied to a config copy), fixed `LINK_PRESETS` |
| `network.js` | Topology from links, `forward()`: carries a frame through store-and-forward switches (VLAN membership on ingress and egress, link down, explicit drops), hop timing |
| `goose.js` | Frame building and length estimate, the subscriber's checks in order: `matchFrame` (filter: MAC/APPID → ignored; identity: gocbRef/datSet/confRev → rejected), `sequenceCheck`, `testHandling` (slice 1.1 hook, pass-through now) |
| `timeline.js` | Discrete-event engine `simulate(config, scenario)`: warm-up (not shown), quiet period, scripted fault and trip, publishing with retransmission and TAL, subscriber supervision, breaker mechanics, outcome. Emits events (each with a full state snapshot) and frames (each with hops and its fate per subscription) |
| `lessons.js` | Lesson content (data) |
| `foundations.js`, `glossary.js`, `figures.js` | Foundations module: chapter content (data, `{{term}}` / `**bold**` markup), shared glossary, pure helpers behind the figures (the switch figures run `network.js` on a four-device demo topology) |
| `units.js`, `colors.js`, `features.js` | Time formatting (ms, plus cycles for protection-relevant times); colors; feature gate (`isActive`) |

Two views (tabs): **Bay simulator** (default) and **Foundations** (`components/foundations/`: chapter list, chapter page with copper anchor, figure, key point, link into the simulator; glossary term bar).

Data flow: `App` (config) → `useRun` (scenario, zoom, playback) → `simulate` → `StationView` (bay diagram, frames in flight, failure controls), `TimingChart` (logic analyzer with frame lanes and subscription status), `OutcomeCard` (verdict, transfer-time budget), `FrameList` / `FrameDetail` (protocol-analyzer view; bottom sheet on phones), `EventLog`.

## Conventions

- **Topology is data.** No engine code names a device; slice 1 is a config with one bay (A–B). The end goal (SPEC § 2.1) is bus A with lines A–X, A–B and a transformer tap A–T; new bays are config entries plus a `LAYOUT` entry in `StationView`
- **Ids** `<function>-<own bus><far end>` as in the sibling: relay `21-AB`, breaker IED `52-AB`; links `L1…`, switches `SW1…`
- **Units:** protection-relevant times stored in cycles (`relayTripCycles`, `breakerOpenCycles`, …); communication times in ms; network in Mbit/s and µs. Engine time in seconds; the fault is at t = 0; the run starts at `START_T` (−3 s). Display: ms everywhere, plus cycles for fault → trip, transfer, breaker open, clearing
- **Determinism:** no randomness. Loss is explicit (`drops` by link, control block, stNum, sqNum)
- **Schema changes:** bump `version`, add a migration step, add a migration test
- **Progressive disclosure:** optional features behind `config.features.*`, gated only through `isActive()`; with a feature off the app behaves exactly as before
- **Failures are scenario, not config**, so they never leak into settings or lessons that don't set them
- **Mode hooks** (IED `mode`, `lphdSim`, quality `test`, PDU `simulation`, `testHandling`) exist for test mode in slice 1.1; don't remove them
- **Figures:** typical, published values only, labelled "illustrative" until confirmed (SPEC § 7). No organization-specific settings or practices in anything tracked
- **Foundations:** one concept, one figure per chapter; every `{{term}}` must exist in `glossary.js`; numbers quoted in chapters are tested like lesson figures
- **Lessons:** every number a lesson quotes is checked in `sim.test.js`; each lesson declares `expect.verdict`. When a test disagrees with the text, fix the text

## Verifying changes

1. `npm test` in `app/` (Vitest: `sim.test.js` with every lesson, `foundations.test.js` with every chapter figure and glossary link)
2. `npm run build`
3. UI changes: screenshot with headless Chromium (Playwright, outside the project); check desktop, phone (390×844) and ultrawide (3440×1440) when layout changes
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
