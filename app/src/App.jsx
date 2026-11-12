import { useState, useEffect, useMemo } from 'react'
import { defaultConfig } from './lib/schema'
import { stationConfig } from './lib/station'
import { isActive } from './lib/features'
import { LESSONS } from './lib/lessons'
import { useRun } from './hooks/useRun'
import StationView from './components/StationView'
import TimingChart from './components/TimingChart'
import SimControls from './components/SimControls'
import OutcomeCard from './components/OutcomeCard'
import FrameList from './components/FrameList'
import FrameDetail from './components/FrameDetail'
import EventLog from './components/EventLog'
import SettingsPanel from './components/SettingsPanel'
import SVPanel from './components/SVPanel'
import { LessonMenu, LessonCard, loadSeen, saveSeen } from './components/Lessons'
import { WelcomeCard, loadWelcomed, saveWelcomed } from './components/Welcome'
import FoundationsView, { loadRead, saveRead } from './components/foundations/FoundationsView'
import Tour from './components/Tour'
import { HelpContext, HelpLink } from './components/Help'
import { TOUR } from './lib/tour'

const TABS = [
  { id: 'sim', label: 'Bay simulator' },
  { id: 'found', label: 'Foundations' },
]
const CHAPTER_KEY = 'dss.chapter'
const loadChapter = () => { try { return localStorage.getItem(CHAPTER_KEY) || 'A1' } catch { return 'A1' } }

// flash: briefly highlighted (a link from Foundations); spot: the tour's spotlight
const Card = ({ id, flash, spot, className = '', children }) => (
  <section id={id ? `panel-${id}` : undefined}
    className={`bg-white rounded-xl border transition-shadow duration-500 ${spot && spot === id ? 'relative z-[45] border-indigo-400 ring-4 ring-indigo-300' : flash && flash === id ? 'border-indigo-400 ring-4 ring-indigo-200' : 'border-gray-200'} ${className}`}>
    {children}
  </section>
)
const CardHead = ({ title, right, help }) => (
  <div className="flex items-baseline justify-between gap-2 px-4 py-2.5 border-b border-gray-100">
    <h3 className="text-sm font-semibold text-gray-700">{title}{help && <HelpLink chapter={help} />}</h3>{right}
  </div>
)
const isPhone = () => window.matchMedia?.('(max-width: 1023px)').matches

export default function App() {
  const [tab, setTab] = useState('sim')
  const [config, setConfig] = useState(defaultConfig)
  const station = useMemo(() => stationConfig(config), [config])
  const run = useRun(station)
  const detail = isActive(config, 'networkDetail')
  const [selectedFrame, setSelectedFrame] = useState(null)
  const [revealedFor, setRevealedFor] = useState(null)
  const [eventsOpen, setEventsOpen] = useState(true)
  const frame = run.sim.frames.find(f => f.id === selectedFrame) ?? null
  const revealed = run.atEnd || revealedFor === run.sim

  function setFeature(id, on) { setConfig(c => ({ ...c, features: { ...c.features, [id]: on } })) }
  function reset() { setConfig(defaultConfig()) }

  // ── First run ──
  const [welcome, setWelcome] = useState(() => !loadWelcomed())
  function closeWelcome() { setWelcome(false); saveWelcomed() }

  // ── Foundations ──
  const [chapter, setChapter] = useState(loadChapter)
  const [read, setRead] = useState(loadRead)
  function openChapter(id) {
    setChapter(id)
    try { localStorage.setItem(CHAPTER_KEY, id) } catch { /* storage unavailable */ }
    const next = new Set(read).add(id)
    setRead(next)
    saveRead(next)
  }
  function openFoundations() { setTab('found'); setTourStep(null); openChapter(chapter) }
  function openChapterFromSim(id) { setTourStep(null); setTab('found'); openChapter(id); window.scrollTo?.({ top: 0 }) }

  // ── Tour: reading the screen ──
  const [tourStep, setTourStep] = useState(null)
  const tour = tourStep !== null ? TOUR[tourStep] : null
  const spot = tour ? (isPhone() && tour.phonePanel) || tour.panel : null
  function startTour() {
    setConfig(defaultConfig())
    run.loadScenario({})
    run.setZoom('trip')
    setSelectedFrame(null)
    setLessonId(null)
    setTab('sim')
    closeWelcome()
    setTourStep(0)
  }
  useEffect(() => {
    if (!tour) return
    const a = tour.action ?? {}
    if (a.time === 'end') run.setTime(Infinity)
    else if (a.time !== undefined) run.setTime(a.time)
    if (a.select === 'trip' && !isPhone()) {
      const f = run.sim.frames.find(x => x.gocb === 'AB.Trip' && x.sendT > 0)
      if (f) setSelectedFrame(f.id)
    }
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`panel-${spot}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: isPhone() ? 'start' : 'center' })
    })
    return () => cancelAnimationFrame(raf)
  }, [tourStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // "See it in the simulator": switch tabs, set up, scroll to and highlight the panel
  const [flash, setFlash] = useState(null)
  function openInSimulator(sim) {
    setTab('sim')
    if (sim.scenario) { setLessonId(null); run.loadScenario(sim.scenario); run.setZoom('trip'); setSelectedFrame(null) }
    if (sim.action === 'selectTripFrame') {
      const f = run.sim.frames.find(x => x.gocb === 'AB.Trip' && x.sendT > 0)
      if (f) { setSelectedFrame(f.id); run.setTime(f.sendT + 0.0005) }
    }
    setFlash(sim.panel)
  }
  useEffect(() => {
    if (!flash || tab !== 'sim') return
    const target = flash === 'decoded' && window.matchMedia?.('(max-width: 1023px)').matches ? 'frames' : flash
    const raf = requestAnimationFrame(() => document.getElementById(`panel-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    const tm = setTimeout(() => setFlash(null), 2500)
    return () => { cancelAnimationFrame(raf); clearTimeout(tm) }
  }, [flash, tab])

  // ── Lessons ──
  const [lessonId, setLessonId] = useState(null)
  const [seen, setSeen] = useState(loadSeen)
  const lesson = LESSONS.find(l => l.id === lessonId)
  function startLesson(l) {
    const cfg = defaultConfig()
    l.setup?.(cfg)
    setConfig(cfg)
    run.loadScenario(l.scenario ?? {})
    run.setZoom(l.zoom ?? 'trip')
    setSelectedFrame(null)
    setLessonId(l.id)
    setTourStep(null)
    setTab('sim')
    closeWelcome()
    const next = new Set(seen).add(l.id)
    setSeen(next)
    saveSeen(next)
  }
  const step = d => startLesson(LESSONS[LESSONS.indexOf(lesson) + d])

  return (
    <HelpContext.Provider value={openChapterFromSim}>
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header id="panel-header" className={`bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${spot === 'header' ? 'relative z-[45] ring-4 ring-indigo-300' : ''}`}>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">Digital Substation Simulator</h1>
          <p className="text-xs text-gray-500 hidden sm:block">GOOSE, Sampled Values and the network that carries protection</p>
        </div>
        <nav className="order-last sm:order-none w-full sm:w-auto flex gap-1 bg-gray-100 rounded-lg p-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => (t.id === 'found' ? openFoundations() : setTab(t.id))}
              className={`flex-1 sm:flex-none px-3 py-1 text-sm font-semibold rounded-md transition
                ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          <LessonMenu activeId={lessonId} seen={seen} onStart={startLesson} onWelcome={() => { setLessonId(null); setTab('sim'); setWelcome(true) }} onTour={startTour} />
          <SettingsPanel config={config} onFeature={setFeature} onReset={reset} onNetwork={n => setConfig(c => ({ ...c, network: { ...c.network, ...n } }))} />
        </div>
      </header>

      {tab === 'found' && (
        <FoundationsView chapterId={chapter} onOpen={openChapter} read={read} onOpenSim={openInSimulator} onTour={startTour} />
      )}
      {tab === 'sim' && <>
      {!lesson && welcome && <WelcomeCard onStartLesson={() => startLesson(LESSONS[0])} onFoundations={openFoundations} onTour={startTour} onClose={closeWelcome} />}
      {lesson && (
        <LessonCard key={lesson.id} lesson={lesson} onRestart={() => startLesson(lesson)}
          onPrev={() => step(-1)} onNext={() => step(1)} onClose={() => setLessonId(null)} />
      )}

      <main className="flex-1 p-4 flex flex-col gap-4 min-w-0">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem] gap-4">
          <Card id="bay" flash={flash} spot={spot} className="p-4"><StationView config={station} run={run} /></Card>
          <Card id="outcome" flash={flash} spot={spot}>
            <CardHead title="Outcome" help="E1" />
            <OutcomeCard outcome={run.sim.outcome} revealed={revealed} onReveal={() => setRevealedFor(run.sim)} />
          </Card>
        </div>

        <Card id="timing" flash={flash} spot={spot} className="p-4 min-w-0">
          <TimingChart config={station} run={run} selectedFrame={selectedFrame} onSelectFrame={setSelectedFrame}
            controls={<SimControls run={run} freqHz={config.freqHz} />} />
        </Card>

        {station.svSubs?.length > 0 && (
          <Card id="sv" flash={flash} spot={spot} className="p-4 min-w-0">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Sampled Values<HelpLink chapter="B1" /></h3>
            <SVPanel config={run.sim.config} run={run} />
          </Card>
        )}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_26rem] 2xl:grid-cols-[minmax(0,1fr)_26rem_26rem] gap-4 items-start">
          <Card id="frames" flash={flash} spot={spot} className="min-w-0">
            <CardHead title="Frames on the wire" help="B5" right={<span className="text-xs text-gray-400">{run.zoom.label}</span>} />
            <div className="max-h-[22rem] overflow-y-auto" data-scroll-box>
              <FrameList config={run.sim.config} run={run} selectedFrame={selectedFrame} onSelect={setSelectedFrame} detail={detail} />
            </div>
          </Card>
          <Card id="decoded" flash={flash} spot={spot} className="hidden lg:block min-w-0">
            <CardHead title="Decoded frame" help="A2" />
            <div className="max-h-[36rem] overflow-y-auto">
              <FrameDetail config={run.sim.config} frame={frame} detail={detail} />
            </div>
          </Card>
          <Card id="events" flash={flash} spot={spot} className="lg:col-span-2 2xl:col-span-1 min-w-0">
            <CardHead title="Sequence of events" help="E1"
              right={<button onClick={() => setEventsOpen(o => !o)} className="text-xs text-gray-500 hover:text-gray-800">{eventsOpen ? 'Hide' : 'Show'}</button>} />
            {eventsOpen && (
              <div className="max-h-[22rem] overflow-y-auto" data-scroll-box>
                <EventLog events={run.sim.events} eventIdx={run.eventIdx} onSelect={run.setTime} window={run.zoom} />
              </div>
            )}
          </Card>
        </div>
      </main>
      </>}

      {/* Phone / tablet: the decoded frame opens as a bottom sheet */}
      {tab === 'sim' && tour && (
        <Tour step={tourStep} onStep={setTourStep} onClose={() => setTourStep(null)} onChapter={openChapterFromSim} />
      )}

      {tab === 'sim' && frame && !tour && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-y-auto bg-white border-t border-gray-300 rounded-t-2xl shadow-2xl">
          <FrameDetail config={run.sim.config} frame={frame} detail={detail} onClose={() => setSelectedFrame(null)} />
        </div>
      )}
    </div>
    </HelpContext.Provider>
  )
}
