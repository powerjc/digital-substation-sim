import { GLOSSARY } from '../../lib/glossary'
import { chapterById } from '../../lib/foundations'

// The definition of a tapped term, pinned to the bottom of the screen
export default function TermBar({ term, onClose, onChapter }) {
  if (!term) return null
  const g = GLOSSARY[term]
  const ch = chapterById(g.chapter)
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-indigo-200 bg-white shadow-xl px-4 py-3 text-sm">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <span className="font-semibold text-indigo-900">{term}</span>
            <span className="text-gray-700">: {g.def}</span>
            {ch?.built && onChapter && (
              <button onClick={() => onChapter(ch.id)} className="ml-1 text-xs text-indigo-600 hover:text-indigo-900 underline">Chapter {ch.id}</button>
            )}
            {ch && !ch.built && <span className="ml-1 text-xs text-gray-400">(more in chapter {ch.id}, coming)</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1" title="Close">×</button>
        </div>
      </div>
    </div>
  )
}
