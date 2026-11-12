import { useState } from 'react'
import { PARTS, CHAPTERS, SKIP_CHECK, builtChapters, chapterById } from '../../lib/foundations'
import { GLOSSARY, sortedTerms } from '../../lib/glossary'
import RichText from './RichText'
import TermBar from './TermBar'
import WiresFigure from './WiresFigure'
import FrameFigure from './FrameFigure'
import SwitchFigure from './SwitchFigure'
import VlanFigure from './VlanFigure'
import StationFigure from './StationFigure'
import LayersFigure from './LayersFigure'
import { SclFigure, WhereLivesFigure, CommissioningFigure, ClockOffsetFigure, PhaseFigure, ClocksFigure, SyncFigure, HoldoverFigure } from './PartDEFigures'
import { ContactMapFigure, FanoutFigure, DryContactsFigure, LockoutFigure, MatrixFigure } from './PartCFigures'
import { KindsFigure, NameFigure, LnTableFigure, GocbFigure, PublishFigure, SubscribeFigure, TestMatrixFigure } from './PartBFigures'

const FIGURE = { wires: WiresFigure, frame: FrameFigure, switch: SwitchFigure, vlan: VlanFigure, station: StationFigure, layers: LayersFigure,
  kinds: KindsFigure, name: NameFigure, lnTable: LnTableFigure, gocb: GocbFigure, publish: PublishFigure, subscribe: SubscribeFigure, testMatrix: TestMatrixFigure,
  contactMap: ContactMapFigure, fanout: FanoutFigure, dryContacts: DryContactsFigure, lockout: LockoutFigure, matrix: MatrixFigure,
  scl: SclFigure, whereLives: WhereLivesFigure, commissioning: CommissioningFigure,
  clockOffset: ClockOffsetFigure, phase: PhaseFigure, clocks: ClocksFigure, sync: SyncFigure, holdover: HoldoverFigure }
export const GLOSSARY_ID = 'glossary'

// Chapters the viewer has opened: a per-browser convenience, safe to lose
const KEY = 'dss.chaptersRead'
export function loadRead() { try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')) } catch { return new Set() } }
export function saveRead(s) { try { localStorage.setItem(KEY, JSON.stringify([...s])) } catch { /* storage unavailable */ } }

function ChapterNav({ current, read, onOpen }) {
  return (
    <nav className="flex flex-col gap-3 text-sm">
      {PARTS.map(p => (
        <div key={p.id}>
          <div className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Part {p.id}: {p.title}</div>
          {CHAPTERS.filter(c => c.part === p.id).map(c => (
            <button key={c.id} disabled={!c.built} onClick={() => onOpen(c.id)}
              className={`w-full flex items-start gap-2 text-left px-2 py-1 rounded-lg transition
                ${c.id === current ? 'bg-indigo-50 text-indigo-800' : c.built ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-300 cursor-default'}`}>
              <span className="text-xs text-gray-400 w-6 shrink-0 pt-0.5">{c.id}</span>
              <span className="flex-1">{c.title}</span>
              {read.has(c.id) && <span className="text-green-600 text-xs pt-0.5">✓</span>}
            </button>
          ))}
          {!CHAPTERS.some(c => c.part === p.id && c.built) && <div className="px-2 text-xs text-gray-400">coming next</div>}
        </div>
      ))}
      <button onClick={() => onOpen(GLOSSARY_ID)}
        className={`text-left px-2 py-1 rounded-lg ${current === GLOSSARY_ID ? 'bg-indigo-50 text-indigo-800' : 'text-gray-700 hover:bg-gray-50'}`}>
        Glossary
      </button>
    </nav>
  )
}

function SkipCheck({ onOpen }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left font-semibold text-gray-700">
        {open ? '▾' : '▸'} Already know networking? Check yourself and skip ahead
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-gray-600">{SKIP_CHECK.intro}</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            {SKIP_CHECK.questions.map((q, i) => (
              <li key={i} className="text-gray-800">{q.q}
                <details className="text-gray-600"><summary className="cursor-pointer text-indigo-700 text-xs">answer</summary>{q.a}</details>
              </li>
            ))}
          </ol>
          <button onClick={() => onOpen(SKIP_CHECK.skipTo)} className="self-start text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            Skip to {SKIP_CHECK.skipTo}: {chapterById(SKIP_CHECK.skipTo).title}
          </button>
        </div>
      )}
    </div>
  )
}

function Chapter({ c, onOpen, onTerm, onOpenSim, onTour }) {
  const built = builtChapters()
  const i = built.indexOf(c)
  const prev = built[i - 1], next = built[i + 1]
  const part = PARTS.find(p => p.id === c.part)
  const figs = [c.figure].flat().filter(Boolean).map(id => FIGURE[id])
  const partIdx = CHAPTERS.filter(x => x.part === c.part)
  return (
    <article className="flex flex-col gap-4 px-4 sm:px-6 py-5 max-w-3xl">
      <header>
        <div className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">Part {part.id}: {part.title} · {partIdx.indexOf(c) + 1} of {partIdx.length}</div>
        <h2 className="text-xl font-bold text-gray-900 mt-0.5">{c.id}. {c.title}</h2>
      </header>
      {c.id === 'A1' && <SkipCheck onOpen={onOpen} />}
      <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-2.5 text-sm text-gray-800"><RichText text={c.copper} onTerm={onTerm} /></div>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-gray-800">
        {c.body.map((p, k) => <p key={k}><RichText text={p} onTerm={onTerm} /></p>)}
      </div>
      {figs.map((Fig, k) => (
        <div key={k} className="rounded-xl border border-gray-200 p-3 sm:p-4">
          <Fig onOpenSim={onOpenSim} />
        </div>
      ))}
      <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-2.5 text-sm text-indigo-900">
        <span className="font-semibold">Key point: </span>{c.key}
      </div>
      {c.sim && (
        <button onClick={() => onOpenSim(c.sim)} className="self-start text-sm px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-700 bg-white hover:border-indigo-500">
          {c.sim.label} →
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
        {prev && <button onClick={() => onOpen(prev.id)} className="text-sm px-3 py-1 rounded-lg border border-gray-300 text-gray-700 bg-white hover:border-gray-500">◀ {prev.id}. {prev.title}</button>}
        <span className="flex-1" />
        {next ? (
          <button onClick={() => onOpen(next.id)} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">{next.id}. {next.title} ▶</button>
        ) : (
          onTour && <button onClick={onTour} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Next: reading the simulator screen ▶</button>
        )}
      </div>
    </article>
  )
}

function Glossary({ onOpen }) {
  return (
    <article className="px-4 sm:px-6 py-5 max-w-3xl">
      <h2 className="text-xl font-bold text-gray-900 mb-3">Glossary</h2>
      <dl className="flex flex-col gap-2 text-sm">
        {sortedTerms().map(t => {
          const g = GLOSSARY[t]
          const ch = chapterById(g.chapter)
          return (
            <div key={t} className="border-b border-gray-50 pb-2">
              <dt className="font-semibold text-gray-900">{t}</dt>
              <dd className="text-gray-700">{g.def}{' '}
                {ch?.built ? <button onClick={() => onOpen(ch.id)} className="text-xs text-indigo-600 underline">{ch.id}</button>
                  : <span className="text-xs text-gray-400">{ch?.id} (coming)</span>}
              </dd>
            </div>
          )
        })}
      </dl>
    </article>
  )
}

export default function FoundationsView({ chapterId, onOpen, read, onOpenSim, onTour }) {
  const [term, setTerm] = useState(null)
  const c = chapterById(chapterId)
  const open = id => { setTerm(null); onOpen(id); window.scrollTo?.({ top: 0 }) }
  const options = [...builtChapters().map(x => ({ id: x.id, label: `${x.id}. ${x.title}` })), { id: GLOSSARY_ID, label: 'Glossary' }]
  return (
    <div className="flex-1 p-4 grid lg:grid-cols-[17rem_minmax(0,1fr)] gap-4 items-start">
      <aside className="hidden lg:block bg-white rounded-xl border border-gray-200 p-3 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
        <ChapterNav current={chapterId} read={read} onOpen={open} />
      </aside>
      <div className="lg:hidden">
        <select value={chapterId} onChange={e => open(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-sm" aria-label="Chapter">
          {options.map(o => <option key={o.id} value={o.id}>{read.has(o.id) ? '✓ ' : ''}{o.label}</option>)}
        </select>
      </div>
      <main className="bg-white rounded-xl border border-gray-200 min-w-0 pb-16">
        {chapterId === GLOSSARY_ID || !c?.built ? <Glossary onOpen={open} /> : <Chapter c={c} onOpen={open} onTerm={setTerm} onOpenSim={onOpenSim} onTour={onTour} />}
      </main>
      <TermBar term={term} onClose={() => setTerm(null)} onChapter={open} />
    </div>
  )
}
