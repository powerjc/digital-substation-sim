import { TOUR } from '../lib/tour'
import { chapterById } from '../lib/foundations'

// The tour's callout, pinned to the bottom of the screen. The spotlighted
// panel is raised above a dimming overlay by App (Card spot prop).
export default function Tour({ step, onStep, onClose, onChapter }) {
  const s = TOUR[step]
  const ch = s.chapter && chapterById(s.chapter)
  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/30 pointer-events-none" />
      <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3">
        <div className="w-full max-w-xl rounded-xl border border-indigo-300 bg-white shadow-2xl px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">Reading the screen · {step + 1} of {TOUR.length}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1" title="End tour">×</button>
          </div>
          <h3 className="text-base font-bold text-gray-900 mt-0.5">{s.title}</h3>
          <p className="text-sm text-gray-700 mt-1">{s.text}</p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {ch && (
              <button onClick={() => onChapter(ch.id)} className="text-sm text-indigo-700 underline">Foundations {ch.id}: {ch.title}</button>
            )}
            <span className="flex-1" />
            {step > 0 && <button onClick={() => onStep(step - 1)} className="text-sm px-3 py-1 rounded-lg border border-gray-300 text-gray-700 bg-white">◀ Back</button>}
            {step + 1 < TOUR.length
              ? <button onClick={() => onStep(step + 1)} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white">Next ▶</button>
              : <button onClick={onClose} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white">Done</button>}
          </div>
        </div>
      </div>
    </>
  )
}
