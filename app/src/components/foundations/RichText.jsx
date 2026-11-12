import { parseRich } from '../../lib/foundations'
import { lookupTerm } from '../../lib/glossary'

// Paragraph text with **bold** and {{glossary terms}} (tap for the definition)
export default function RichText({ text, onTerm }) {
  return parseRich(text).map((p, i) => {
    if (p.kind === 'code') return <code key={i} className={`font-mono text-[0.9em] bg-gray-100 text-gray-900 px-1 rounded ${p.text.length > 16 ? 'break-all' : 'whitespace-nowrap'}`}>{p.text}</code>
    if (p.kind === 'bold') return <strong key={i} className="font-semibold text-gray-900">{p.text}</strong>
    if (p.kind === 'term') {
      const key = lookupTerm(p.term)
      return (
        <button key={i} type="button" onClick={() => onTerm(key)}
          className="inline text-indigo-700 underline decoration-dotted underline-offset-2 hover:text-indigo-900">
          {p.text}
        </button>
      )
    }
    return <span key={i}>{p.text}</span>
  })
}
