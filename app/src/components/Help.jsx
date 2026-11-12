import { createContext, useContext } from 'react'
import { chapterById } from '../lib/foundations'

// A small "?" beside a panel title that opens its Foundations chapter
export const HelpContext = createContext(null)

export function HelpLink({ chapter }) {
  const open = useContext(HelpContext)
  const ch = chapterById(chapter)
  if (!open || !ch?.built) return null
  return (
    <button onClick={() => open(chapter)} title={`Foundations ${ch.id}: ${ch.title}`} aria-label={`Explain: Foundations ${ch.id}, ${ch.title}`}
      className="inline-flex items-center justify-center w-[18px] h-[18px] ml-1.5 rounded-full border border-indigo-300 text-indigo-600 text-[11px] font-bold leading-none align-middle hover:bg-indigo-50">
      ?
    </button>
  )
}
